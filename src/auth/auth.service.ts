import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from 'src/schemas/user.schema';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { LoginAuthDto } from './dto/login-auth.dto';
import { JwtService } from '@nestjs/jwt';
import { UserIdDto } from 'src/common/dto/mongoId.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
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
  ) {}

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

    try {
      const createdUser = await this.userModel.create({
        ...rest,
        password: hashedPassword,
      });

      // convert created user document to plain object
      const user = createdUser.toObject();
      // remove password field from user object before returning to client
      delete user.password;

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
}
