import {
  Req,
  UseGuards,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Res,
} from '@nestjs/common';
import { Request } from 'express';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { UserIdDto } from 'src/common/dto/mongoId.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { AuthUser } from 'src/common/interface/auth-user.interface';

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
    const { accessToken, user } = req.user;

    // Set cookie
    res.setHeader(
      'Set-Cookie',
      `accessToken=${accessToken}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );

    // Get frontend URL
    const frontendUrl =
      process.env.FRONTEND_BASE_URL || 'http://localhost:3000';

    // DIRECT REDIRECT based on role
    const userRole = user.role?.toLowerCase() || 'user';

    if (userRole === 'admin') {
      return res.redirect(`${frontendUrl}/admin`);
    } else {
      return res.redirect(`${frontendUrl}/dashboard/profile`);
    }
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
