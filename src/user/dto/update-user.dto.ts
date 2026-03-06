import { IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'Name must be a string' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Phone must be a string' })
  phone?: string;

  @IsOptional()
  @IsString({ message: 'Home address must be a string' })
  homeAddress?: string;

  @IsOptional()
  @IsString({ message: 'Office address must be a string' })
  officeAddress?: string;

  @IsOptional()
  @IsString({ message: 'Home phone must be a string' })
  homePhone?: string;

  @IsOptional()
  @IsString({ message: 'Office phone must be a string' })
  officePhone?: string;

  @IsOptional()
  @IsString({ message: 'Profile image must be a string' })
  profileImage?: string;

  @IsOptional()
  @IsString({ message: 'Website link must be a string' })
  websiteLink?: string;

  @IsOptional()
  @IsString({ message: 'Facebook link must be a string' })
  facebookLink?: string;

  @IsOptional()
  @IsString({ message: 'Instagram link must be a string' })
  instagramLink?: string;

  @IsOptional()
  @IsString({ message: 'Twitter link must be a string' })
  twitterLink?: string;

  @IsOptional()
  @IsString({ message: 'LinkedIn link must be a string' })
  linkedinLink?: string;
}
