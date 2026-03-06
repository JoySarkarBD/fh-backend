import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'matchPassword', async: false })
class MatchPasswordConstraint implements ValidatorConstraintInterface {
  validate(confirmPassword: string, args: ValidationArguments) {
    const dto = args.object as CreateAuthDto;
    return dto.password === confirmPassword;
  }

  defaultMessage() {
    return 'Confirm password must match password';
  }
}

export class CreateAuthDto {
  @IsOptional()
  @IsString({ message: 'Message must be a string' })
  message?: string;

  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required & must be a string' })
  name: string;

  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required & must be a valid email address' })
  email: string;

  @IsString({ message: 'Phone must be a string' })
  @IsNotEmpty({ message: 'Phone is required & must be a string' })
  phone: string;

  @IsOptional()
  @IsString({ message: 'Home address must be a string' })
  homeAddress?: string;

  @IsOptional()
  @IsString({ message: 'Office address must be a string' })
  officeAddress?: string;

  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required & must be a string' })
  password: string;

  @IsString({ message: 'Confirm password must be a string' })
  @IsNotEmpty({ message: 'Confirm password is required & must be a string' })
  @ValidateIf((dto: CreateAuthDto) => Boolean(dto.confirmPassword))
  @Validate(MatchPasswordConstraint)
  confirmPassword: string;

  @IsOptional()
  @IsBoolean({ message: 'Is subscribed must be a boolean' })
  isSubscribed?: boolean;
}
