import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { UserIdDto } from 'src/common/dto/mongoId.dto';
import { MailService } from 'src/mail/mail.service';
import { User, UserDocument, UserRole } from 'src/schemas/user.schema';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateAuthDto } from './dto/create-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  private readonly PASSWORD_RESET_EXPIRY_MS = 1000 * 60 * 15;

  /**
   * AuthService handles registration, authentication and password flows.
   *
   * It uses Mongoose for database interactions and JWT for token generation.
   *
   * @param userModel Mongoose model for User schema
   * @param jwtService Service for generating JWT tokens
   */
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  private readonly logger = new Logger(AuthService.name);

  private getFrontendBaseUrl(): string {
    const raw = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
    return raw.split(',')[0].trim();
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async notifyAdminsNewRegistration(user: {
    name?: string;
    email: string;
    role?: string;
  }) {
    try {
      const admins = await this.userModel
        .find({
          role: UserRole.ADMIN,
          isSuspended: { $ne: true },
          email: { $exists: true, $ne: '' },
        })
        .select('email name')
        .lean();

      if (!admins.length) {
        return;
      }

      const subject = 'New user registration alert';
      const text = `A new user has registered. Name: ${user.name || 'N/A'}, Email: ${user.email}, Role: ${user.role || 'user'}.`;

      await Promise.all(
        admins.map((admin) => {
          const html = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
    <h2 style="color: #c26828; margin-top: 0;">New User Registration</h2>
    <p>Hello ${admin.name || 'Admin'},</p>
    <p>A new user has registered on the platform.</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <tr>
        <td style="padding: 10px; background: #f8f8f8; font-weight: bold; width: 30%;">Name</td>
        <td style="padding: 10px; background: #f8f8f8;">${user.name || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding: 10px; font-weight: bold;">Email</td>
        <td style="padding: 10px;">${user.email}</td>
      </tr>
      <tr>
        <td style="padding: 10px; background: #f8f8f8; font-weight: bold;">Role</td>
        <td style="padding: 10px; background: #f8f8f8;">${user.role || 'user'}</td>
      </tr>
    </table>
  </div>
`;
          return this.mailService.sendMailDirect({
            to: admin.email,
            subject,
            text,
            html,
          });
        }),
      );
    } catch (error) {
      console.error(
        '[ADMIN-REPORT] Failed to notify admins on registration:',
        error,
      );
    }
  }

  /**
   * Register a new user with the provided details.
   *
   * @param createAuthDto data - registration data including email, password, etc.
   * @returns a success message on completion
   */
  async create(createAuthDto: CreateAuthDto) {
    const {
      confirmPassword,
      password,
      message: customMessage,
      ...rest
    } = createAuthDto;

    if (!password || !confirmPassword) {
      throw new BadRequestException(
        'Password and confirm password are required for normal registration',
      );
    }

    if (confirmPassword && !password) {
      throw new BadRequestException(
        'Password is required when confirm password is provided',
      );
    }

    if (password !== confirmPassword) {
      throw new BadRequestException('Confirm password must match password');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const fallbackAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(rest.name || 'User')}&background=0D8ABC&color=fff`;

    try {
      const createdUser = await this.userModel.create({
        ...rest,
        password: hashedPassword,
        profileImage: {
          key: fallbackAvatarUrl,
          image: fallbackAvatarUrl,
        },
      });

      // convert created user document to plain object
      const user = createdUser.toObject();
      // remove password field from user object before returning to client
      delete user.password;

      void this.notifyAdminsNewRegistration({
        name: user.name,
        email: user.email,
        role: user.role,
      });

      return {
        message: customMessage || 'User created successfully',
        data: user,
      };
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new ConflictException('Email or phone already exists');
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name?: string }).name === 'ValidationError'
      ) {
        throw new BadRequestException('Invalid registration data');
      }

      throw error;
    }
  }

  /**
   * Authenticate a user with email and password, and return an access token on success.
   *
   * @param loginAuthDto data - login data including email and password
   * @returns a success message, access token and user data on successful authentication, or throws an error if authentication fails
   */
  async login(loginAuthDto: LoginAuthDto) {
    const { email, password } = loginAuthDto;

    const user = await this.userModel
      .findOne({ email })
      .select('+password')
      .lean();

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatched = await bcrypt.compare(password, user.password);
    if (!passwordMatched) {
      throw new UnauthorizedException('Password does not match');
    }

    // if user is suspended, prevent login
    if (user.isSuspended) {
      throw new UnauthorizedException(
        'Your account has been suspended. Please contact support for assistance.',
      );
    }

    // create JWT token with user id, email and role as payload
    const payload = {
      sub: String(user._id),
      email: user.email,
      role: user.role,
      // isSubscribed: user.isSubscribed,
    };

    // sign the payload to create JWT token
    const accessToken = await this.jwtService.signAsync(payload);

    // remove password field from user object before returning
    delete user.password;

    // return success message, access token and user data in the response
    return {
      message: 'Login successful',
      data: {
        accessToken,
        user,
      },
    };
  }

  /**
   * Fetch a paginated list of all users in the system, with optional search functionality.
   *
   * @returns a list of all users with their details, excluding passwords, along with a success message. Throws an error if fetching users fails.
   *
   * This is for admin use to view all registered users in the system.
   */
  async changePassword(
    userId: UserIdDto['userId'],
    changePasswordDto: ChangePasswordDto,
  ) {
    const { currentPassword, newPassword, confirmNewPassword } =
      changePasswordDto;

    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException(
        'Confirm new password must match new password',
      );
    }

    const user = await this.userModel
      .findById(userId)
      .select('+password')
      .exec();
    if (!user || !user.password) {
      throw new NotFoundException('User not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return {
      message: 'Password updated successfully',
      data: null,
    };
  }

  async requestPasswordReset(forgotPasswordDto: ForgotPasswordDto) {
    const email = forgotPasswordDto.email.toLowerCase().trim();

    const genericResponse = {
      message:
        'If an account exists for this email, a password reset link has been sent.',
      data: null,
    };

    const user = await this.userModel.findOne({ email }).exec();

    if (!user || user.isSuspended) {
      return genericResponse;
    }

    const resetToken = randomBytes(32).toString('hex');
    const hashedToken = this.hashResetToken(resetToken);
    const expiresAt = new Date(Date.now() + this.PASSWORD_RESET_EXPIRY_MS);

    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordToken: hashedToken,
            resetPasswordExpires: expiresAt,
          },
        },
      )
      .exec();

    const resetUrl = `${this.getFrontendBaseUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;

    const subject = 'Reset your Farrior Homes password';
    const text = `We received a request to reset your password. Use this link within 15 minutes: ${resetUrl}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1b1b1a; margin-top: 0;">Reset your password</h2>
        <p>Hello ${user.name || 'there'},</p>
        <p>We received a request to reset your Farrior Homes account password.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background: #619B7F; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 6px; display: inline-block;">Reset Password</a>
        </p>
        <p>This link expires in 15 minutes.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `;

    try {
      await this.mailService.sendMail({
        to: user.email,
        subject,
        text,
        html,
      });
    } catch (error) {
      this.logger.error(
        'Failed to enqueue password reset email',
        String(error),
      );
    }

    return genericResponse;
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword, confirmNewPassword } = resetPasswordDto;

    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException(
        'Confirm new password must match new password',
      );
    }

    const hashedToken = this.hashResetToken(token);

    const user = await this.userModel
      .findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
      })
      .select('+password +resetPasswordToken +resetPasswordExpires')
      .exec();

    if (!user) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userModel
      .updateOne(
        { _id: user._id },
        {
          $set: { password: hashedPassword },
          $unset: {
            resetPasswordToken: '',
            resetPasswordExpires: '',
          },
        },
      )
      .exec();

    return {
      message: 'Password reset successfully',
      data: null,
    };
  }
}
