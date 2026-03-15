import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model } from 'mongoose';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { User, UserDocument, UserRole } from 'src/schemas/user.schema';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
  ) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:5000/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: {
      id: string;
      displayName?: string;
      emails?: Array<{ value?: string }>;
      photos?: Array<{ value?: string }>;
    },
    done: VerifyCallback,
  ) {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(new Error('Google account email is required'), false);
      }

      let user = await this.userModel
        .findOne({ $or: [{ googleId: profile.id }, { email }] })
        .exec();

      if (!user) {
        const googlePhotoUrl = profile.photos?.[0]?.value;
        user = new this.userModel({
          googleId: profile.id,
          name: profile.displayName || email.split('@')[0],
          email,
          profileImage: {
            key: googlePhotoUrl || 'google/default-profile-image',
            image: googlePhotoUrl || 'https://via.placeholder.com/150',
          },
          role: UserRole.USER,
          password: '',
        });

        await user.save();
      } else if (!user.googleId) {
        user.googleId = profile.id;
        if (!user.profileImage && profile.photos?.[0]?.value) {
          user.profileImage = {
            key: profile.photos[0].value,
            image: profile.photos[0].value,
          };
        }
        await user.save();
      }

      if (user.isSuspended) {
        return done(null, {
          error: 'suspended',
          message:
            'Your account has been suspended. Please contact support for assistance.',
        });
      }

      const token = await this.jwtService.signAsync({
        sub: String(user._id),
        email: user.email,
        role: user.role,
      });

      done(null, {
        user: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          profileImage: user.profileImage,
        },
        accessToken: token,
      });
    } catch (error) {
      done(error as Error, false);
    }
  }
}
