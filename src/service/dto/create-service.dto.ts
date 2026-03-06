import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// DTO for individual description items within the service description array
export class DescriptionItemDto {
  @IsOptional()
  @IsMongoId({ message: 'Description id must be a valid Mongo id' })
  id?: string;

  @IsString({ message: 'Description text must be a string' })
  @IsNotEmpty({ message: 'Description text is required' })
  text: string;
}

// DTO for creating a new service, which includes validation rules for the service properties
export class CreateServiceDto {
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required & must be a string' })
  title: string;

  @IsString({ message: 'Sub title must be a string' })
  @IsNotEmpty({ message: 'Sub title is required & must be a string' })
  subTitle: string;

  @IsArray({ message: 'Description must be an array' })
  @IsNotEmpty({ message: 'Description is required' })
  @ArrayMaxSize(4, { message: 'Maximum 4 description items are allowed' })
  @ValidateNested({ each: true })
  @Type(() => DescriptionItemDto)
  description: DescriptionItemDto[];
}
