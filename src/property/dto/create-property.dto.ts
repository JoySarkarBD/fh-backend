import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { PropertyStatus } from 'src/schemas/property.schema';

export class CreatePropertyDto {
  @IsString({ message: 'Property name is required' })
  propertyName!: string;

  @IsEnum(PropertyStatus, {
    message: `Status - (allowed values: ${Object.values(PropertyStatus).join(', ')})`,
  })
  status!: PropertyStatus;

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
  moreDetails!: string;

  @IsOptional()
  @IsUrl({}, { message: 'Location map link must be a valid URL' })
  locationMapLink?: string;

  @IsOptional()
  @IsBoolean({ message: 'IsPosted must be boolean' })
  IsPosted?: boolean;

  @IsOptional()
  @IsString({ message: 'Posting date must be string' })
  sellPostingDate?: string;

  @IsOptional()
  @IsString({ message: 'Posting Time must be string' })
  sellPostingTime?: string;

  @IsOptional()
  thumbnail?: any;

  @IsOptional()
  images?: any;
}
