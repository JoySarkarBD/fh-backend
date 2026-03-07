import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserRole } from 'src/schemas/user.schema';
import { ArticleService } from './article.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AwsService } from 'src/common/aws/aws.service';
import { FileFieldsInterceptor } from '@nestjs/platform-express/multer/interceptors/file-fields.interceptor';
import { memoryStorage } from 'multer';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

@Controller('article')
export class ArticleController {
  constructor(
    private readonly articleService: ArticleService,
    private readonly awsService: AwsService,
  ) {}
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  // Image upload handling with validation
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'image', maxCount: 1 }], {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async create(
    @Body() createArticleDto: CreateArticleDto & { image?: string },
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: { image?: Express.Multer.File[] },
  ) {
    const imageFile = files?.image?.[0];
    let imageUrl: string;

    if (imageFile) {
      imageUrl = await this.awsService.uploadFile(
        imageFile,
        `articles/${user.userId}`,
      );
    } else if (
      typeof createArticleDto.image === 'string' &&
      createArticleDto.image.trim().length > 0
    ) {
      imageUrl = createArticleDto.image.trim();
    } else {
      throw new BadRequestException('Image is required');
    }

    const dtoWithFile = {
      ...createArticleDto,
      image: {
        key: this.awsService.extractKeyFromUrl
          ? (this.awsService.extractKeyFromUrl(imageUrl) ?? imageUrl)
          : imageUrl,
        image: imageUrl,
      },
    };
    try {
      return await this.articleService.create(dtoWithFile, user);
    } catch (err) {
      // Rollback: delete uploaded image from S3 if DB save fails
      const key = dtoWithFile.image.key;
      if (key) {
        await this.awsService.deleteFile(key).catch(() => {});
      }
      throw err;
    }
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return await this.articleService.findAll(query);
  }

  @Get(':id')
  findOne(@Param() param: MongoIdDto) {
    return this.articleService.findOne(param.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'image', maxCount: 1 }], {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async update(
    @Param() param: MongoIdDto,
    @Body() updateArticleDto: UpdateArticleDto & { image?: string },
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: { image?: Express.Multer.File[] },
  ) {
    let updatedDto: any = { ...updateArticleDto };
    let uploadedImageKey: string | null = null;

    if (files?.image?.[0]) {
      // If a new image is provided, upload and set it
      const image = files.image[0];
      const imageUrl = await this.awsService.uploadFile(
        image,
        `articles/${user.userId}`,
      );
      uploadedImageKey =
        this.awsService.extractKeyFromUrl(imageUrl) ?? imageUrl;
      updatedDto.image = {
        key: uploadedImageKey,
        image: imageUrl,
      };
    } else if (
      typeof updateArticleDto.image === 'string' &&
      updateArticleDto.image.trim().length > 0
    ) {
      const imageUrl = updateArticleDto.image.trim();
      updatedDto.image = {
        key: this.awsService.extractKeyFromUrl(imageUrl) ?? imageUrl,
        image: imageUrl,
      };
    }

    try {
      return await this.articleService.update(param.id, updatedDto);
    } catch (error) {
      // Rollback newly uploaded image if DB update fails
      if (uploadedImageKey) {
        await this.awsService.deleteFile(uploadedImageKey).catch(() => {});
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param() param: MongoIdDto) {
    return this.articleService.remove(param.id);
  }
}
