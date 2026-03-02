import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Article } from 'src/schemas/article.schema';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

@Injectable()


export class ArticleService {


  /**
   * Article Service handles Create Article,Get Article Delete and update.
   *
 
   * @param ArticleModel Mongoose model for Article  schema
   */

 constructor(
    @InjectModel(Article.name) private readonly ArticleModel: Model<Article>,

  ) {}

    /**
   * Create a New Article 
   *
   * @param CreateArticleDto data - Article  data including image, title, blog details etc.
   * @returns a success message on completion
   */
  async create(createArticleDto: CreateArticleDto) {
  const newArticle = new this.ArticleModel(createArticleDto)
 return await newArticle.save();
  }

  findAll() {
    return `This action returns all article`;
  }

  findOne(id: number) {
    return `This action returns a #${id} article`;
  }

  update(id: number, updateArticleDto: UpdateArticleDto) {
    return `This action updates a #${id} article`;
  }

  remove(id: number) {
    return `This action removes a #${id} article`;
  }
}
