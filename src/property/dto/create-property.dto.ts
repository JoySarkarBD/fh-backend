import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PropertyModerationStatus,
  PropertyStatus,
} from 'src/schemas/property.schema';

export class CreatePropertyDto {
  @IsString({ message: 'Property name is required' })
  propertyName!: string;

  @IsString({ message: 'Property type is required' })
  propertyType!: string;

  @IsEnum(PropertyStatus, {
    message: `Property status must be one of: ${Object.values(PropertyStatus).join(', ')}`,
  })
  propertyStatus!: PropertyStatus;

  @IsOptional()
  @IsEnum(PropertyModerationStatus, {
    message: `Moderation status must be one of: ${Object.values(PropertyModerationStatus).join(', ')}`,
  })
  moderationStatus?: PropertyModerationStatus;

  @IsString({ message: 'Overview is required' })
  overview!: string;

  @IsString({ message: 'Key features are required' })
  keyFeatures!: string;

  @Type(() => Number)
  @IsNumber({}, { message: 'Bedrooms must be a number' })
  @Min(0)
  bedrooms!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Bathrooms must be a number' })
  @Min(0)
  bathrooms!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Square feet must be a number' })
  @Min(0)
  squareFeet!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Lot size must be a number' })
  @Min(0)
  lotSize!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0)
  price!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'Year built must be a number' })
  yearBuilt!: number;

  @IsString({ message: 'More details are required' })
  moreDetails?: string;

  @IsOptional()
  // @IsUrl({}, { message: 'Location map link must be a valid URL' })
  locationMapLink?: string;

  @IsString({ message: 'Address is required' })
  address!: string;

  @IsOptional()
  @IsString({ message: 'Posting date must be string' })
  sellPostingDate?: string;

  @IsOptional()
  @IsString({ message: 'Posting time must be string' })
  sellPostingTime?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean({ message: 'isPublished must be boolean' })
  isPublished?: boolean;

  @IsOptional()
  thumbnail?: any;

  @IsOptional()
  images?: any;


}
