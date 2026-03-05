import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ArticleCategory } from 'src/schemas/article.schema';

export class CreateArticleDto {

  @IsString({ message: 'Article title must be a string.' })
  @IsNotEmpty({ message: 'Article title is required.' })
  title: string;

  @IsOptional()
  @IsDateString({}, { message: 'Publish date must be a valid date.' })
  publishDate?: string;

  @IsString({ message: 'Blog details must be a string.' })
  @IsNotEmpty({ message: 'Blog details are required.' })
  blogDetails: string;

  @IsString({ message: 'Image URL must be a string.' })
  @IsNotEmpty({ message: 'Image is required.' })
  image: string;

  @IsEnum(ArticleCategory, { message: 'Category must be one of: SELLING_TIPS, BUYING_GUIDE, MARKET_ANALYSIS.' })
  @IsNotEmpty({ message: 'Category is required.' })
  category: ArticleCategory;
}