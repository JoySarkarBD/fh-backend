import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Article } from 'src/schemas/article.schema';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { AwsService } from 'src/common/aws/aws.service';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

@Injectable()
export class ArticleService {
  /**
   * Article Service handles Create Article,Get Article Delete and update.
   *
 
   * @param ArticleModel Mongoose model for Article  schema
   */

  constructor(
    @InjectModel(Article.name) private readonly ArticleModel: Model<Article>,
    private readonly awsService: AwsService,
  ) {}

  /**
   * Create a New Article
   *
   * @param CreateArticleDto data - Article  data including image, title, blog details etc.
   * @returns a success message on completion
   */
  async create(createArticleDto: CreateArticleDto, user: AuthUser) {
    const newArticle = new this.ArticleModel({
      ...createArticleDto,
      createdBy: new Types.ObjectId(user.userId),
    });
    const result = await newArticle.save();
    let image = await this.awsService.generateSignedUrl(result.image.key);
    
 
    return {
      ...result.toObject(),
      image,
    };
  }

  /**
   * Create a New Article
   *
   * This method accepts article details and saves a new article to the database.
   *
   * @param {CreateArticleDto} data - The article data including:
   *   - title: The title of the article (string, required)
   *   - publishDate: The publish date of the article (string, optional)
   *   - blogDetails: The main content/details of the article (string, required)
   *   - image: URL of the article image (string, required)
   *   - category: Article category (enum: SELLING_TIPS, BUYING_GUIDE, MARKET_ANALYSIS)
   *
   * @returns {Promise<{ message: string; articleId: string }>}
   *   Returns a success message and the ID of the newly created article.
   *
   * @throws {BadRequestException} If validation fails or required fields are missing.
   */

  async findAll(query) {
    const { limit = 10, page = 1 } = query; // default values
    const skip = (page - 1) * limit;

    // Assuming you are using Mongoose model Article
    const articles = await this.ArticleModel.find()
      .sort({ publishDate: -1 }) // newest first
      .skip(skip)
      .limit(Number(limit));

    const total = await this.ArticleModel.countDocuments();

    return {
      data: articles,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Find an article by ID
   *
   * @param {string} id - Article ID
   * @returns {Promise<Article>} The article document
   * @throws {NotFoundException} If article not found
   */
  async findOne(id: MongoIdDto['id']) {
    const article = await this.ArticleModel.findById(id).exec();
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }
    return article;
  }

  /**
   * Update an article by ID
   *
   * @param {string} id - Article ID
   * @param {UpdateArticleDto} updateArticleDto - Fields to update
   * @returns {Promise<Article>} The updated article document
   * @throws {NotFoundException} If article not found
   */
  async update(
    id: MongoIdDto['id'],
    updateArticleDto: UpdateArticleDto & {
      image: { key: string; image: string } | string;
    },
  ) {
    // Check if new image is provided
    const article = await this.ArticleModel.findById(id).exec();

    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    let oldImageKey: string | null = null;
    // Use type assertion to check for image property
    if (updateArticleDto.image && article.image && article.image.key) {
      oldImageKey = article.image.key;
    }

    const updatedArticle = await this.ArticleModel.findByIdAndUpdate(
      id,
      updateArticleDto,
      { new: true },
    ).exec();

    if(!updatedArticle) {
      throw new NotFoundException(`Article with ID ${id} not found after update`);
    }
    
    // Delete old image from S3 if new image was provided
    if (oldImageKey) {
      await this.awsService.deleteFile(oldImageKey).catch(() => {});
    }

    const result ={
      ...updatedArticle.toObject(),
      image: await this.awsService.generateSignedUrl(updatedArticle.image.key),
    }
    
    return result;
  }
  /**
   * Delete an article by ID
   *
   * @param {string} id - Article ID
   * @returns {Promise<void>} Resolves if deleted successfully
   * @throws {NotFoundException} If article not found
   */
  async remove(id: MongoIdDto['id']): Promise<void> {
    const article = await this.ArticleModel.findById(id).exec();
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }
    const imageKey =
      article.image && article.image.key ? article.image.key : null;
    await this.ArticleModel.findByIdAndDelete(id).exec();
    if (imageKey) {
      await this.awsService.deleteFile(imageKey).catch(() => {});
    }
  }
}
