import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Article, ArticleSchema } from 'src/schemas/article.schema';
import { ArticleController } from './article.controller';
import { ArticleService } from './article.service';
import { AwsService } from 'src/common/aws/aws.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Article.name, schema: ArticleSchema }]),
  ],
  controllers: [ArticleController],
  providers: [ArticleService, AwsService],
})
export class ArticleModule {}
