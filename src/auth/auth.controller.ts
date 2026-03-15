import {
    Body,
    Controller,
    Get,
    Patch,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Request } from 'express';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateAuthDto } from './dto/create-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Register User
  @Post('register')
  create(@Body() createAuthDto: CreateAuthDto) {
    return this.authService.create(createAuthDto);
  }

  // Login User
  @Post('login')
  login(@Body() loginAuthDto: LoginAuthDto) {
    return this.authService.login(loginAuthDto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(forgotPasswordDto);
  }

  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  // User Login with Google
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  googleLogin() {
    return;
  }

  // // Google OAuth callback endpoint
  // @UseGuards(GoogleAuthGuard)
  // @Get('google/callback')
  // googleCallback(@Req() req: Request & { user: unknown }) {
  //   return req.user;
  // }

  // Google OAuth callback endpoint
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  googleCallback(@Req() req: Request & { user: any }, @Res() res: Response) {
    const { accessToken, user, error, message } = req.user || {};

    // Get frontend URL
    const frontendUrl =
      process.env.FRONTEND_BASE_URL || 'http://localhost:3000';

    if (error === 'suspended') {
      const text =
        typeof message === 'string' && message.trim().length > 0
          ? message
          : 'Your account has been suspended. Please contact support for assistance.';

      return res.redirect(
        `${frontendUrl}/login?googleError=suspended&message=${encodeURIComponent(text)}`,
      );
    }

    if (!accessToken || !user) {
      return res.redirect(`${frontendUrl}/login?googleError=failed`);
    }

    const userRole = user.role?.toLowerCase() || 'user';

    // Redirect to frontend callback page with token so it can be stored
    // as an accessible (non-HttpOnly) cookie, consistent with the normal login flow
    return res.redirect(
      `${frontendUrl}/google/callback?token=${encodeURIComponent(accessToken)}&role=${userRole}`,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, changePasswordDto);
  }
}
