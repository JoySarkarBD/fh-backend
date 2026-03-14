import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'Token must be a string' })
  @IsNotEmpty({ message: 'Token is required' })
  token!: string;

  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(6, { message: 'New password must be at least 6 characters long' })
  newPassword!: string;

  @IsString({ message: 'Confirm new password must be a string' })
  @IsNotEmpty({ message: 'Confirm new password is required' })
  confirmNewPassword!: string;
}
