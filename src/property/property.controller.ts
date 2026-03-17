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
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';
import { AwsService } from 'src/common/aws/aws.service';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { UserRole } from 'src/schemas/user.schema';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyService } from './property.service';

@Controller('property')
export class PropertyController {
  constructor(
    private readonly propertyService: PropertyService,
    private readonly awsService: AwsService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, SubscribedUserGuard)
  @Roles(UserRole.USER)
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 10 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
          if (!file.mimetype.startsWith('image/')) {
            return cb(
              new BadRequestException('Only image files are allowed'),
              false,
            );
          }
          cb(null, true);
        },
      },
    ),
  )
  async create(
    @Body() createPropertyDto: CreatePropertyDto,
    @CurrentUser() user: AuthUser,
    @UploadedFiles()
    files?: {
      images?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    if (!files?.thumbnail?.length) {
      throw new BadRequestException('Thumbnail is required');
    }

    if (!files?.images?.length) {
      throw new BadRequestException('At least one image is required');
    }

    const thumbnailFile = files.thumbnail[0];
    const imageFiles = files.images;

    // Upload files and get URLs
    const thumbnailUrl = await this.awsService.uploadFile(
      thumbnailFile,
      `properties/${user.userId}/thumbnail`,
    );
    const imageUrls = await this.awsService.uploadMultipleFiles(
      imageFiles,
      `properties/${user.userId}/images`,
    );

    const dtoWithFiles = {
      ...createPropertyDto,
      thumbnail: {
        key: this.awsService.extractKeyFromUrl(thumbnailUrl) ?? thumbnailUrl,
        image: thumbnailUrl,
      },
      images: imageUrls.map((url) => ({
        key: this.awsService.extractKeyFromUrl(url) ?? url,
        image: url,
      })),
    };
    try {
      return await this.propertyService.create(dtoWithFiles, user);
    } catch (error) {
      // Rollback uploaded S3 files when DB save fails
      const thumbnailKey = dtoWithFiles.thumbnail?.key;
      const imageKeys = (dtoWithFiles.images || []).map((img) => img.key);
      const keys = [thumbnailKey, ...imageKeys].filter(
        (key): key is string => !!key,
      );

      await this.awsService.deleteMultipleFiles(keys).catch(() => {});
      throw error;
    }
  }

  @Get('/topFour')
  topFourProperty(){
    return this.propertyService.topFourProperty()
  }
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: Record<string, any>) {
    console.log(user);
    return this.propertyService.findAll(user, query);
  }
  @UseGuards(JwtAuthGuard, SubscribedUserGuard)
  @Get('me')
  findAllOwnProperty(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, any>,
  ) {
    console.log(user);
    return this.propertyService.findAllOwnProperty(user, query);
  }

  @Get(':id')
  findOne(@Param() param: MongoIdDto) {
    return this.propertyService.findOne(param.id);
  }

  @UseGuards(JwtAuthGuard, SubscribedUserGuard)
  @Roles(UserRole.USER)
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 10 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 },
        fileFilter: (req, file, cb) => {
          if (!file.mimetype.startsWith('image/')) {
            return cb(
              new BadRequestException('Only image files are allowed'),
              false,
            );
          }
          cb(null, true);
        },
      },
    ),
  )
  async update(
    @Param() param: MongoIdDto,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @CurrentUser() user: AuthUser,
    @UploadedFiles()
    files?: {
      images?: Express.Multer.File[];
      thumbnail?: Express.Multer.File[];
    },
  ) {
    console.log('\n========== 🧭 PROPERTY CONTROLLER UPDATE HIT ==========');
    console.log(`[PropertyController.update] Property ID: ${param.id}`);
    console.log(`[PropertyController.update] User ID: ${user?.userId}`);
    console.log(
      `[PropertyController.update] Body keys: ${Object.keys(updatePropertyDto || {}).join(', ')}`,
    );

    const dtoWithFiles: UpdatePropertyDto & {
      images?: { key: string; image: string }[];
      thumbnail?: { key: string; image: string };
    } = { ...updatePropertyDto };

    let uploadedKeys: string[] = [];

    if (files?.thumbnail?.length) {
      const thumbnailUrl = await this.awsService.uploadFile(
        files.thumbnail[0],
        `properties/${user.userId}/thumbnail`,
      );
      const thumbnailKey =
        this.awsService.extractKeyFromUrl(thumbnailUrl) ?? thumbnailUrl;
      dtoWithFiles.thumbnail = { key: thumbnailKey, image: thumbnailUrl };
      uploadedKeys.push(thumbnailKey);
    }

    if (files?.images?.length) {
      const imageUrls = await this.awsService.uploadMultipleFiles(
        files.images,
        `properties/${user.userId}/images`,
      );
      dtoWithFiles.images = imageUrls.map((url) => {
        const key = this.awsService.extractKeyFromUrl(url) ?? url;
        uploadedKeys.push(key);
        return { key, image: url };
      });
    }

    try {
      const response = await this.propertyService.update(
        param.id,
        dtoWithFiles,
        user,
      );
      console.log('[PropertyController.update] ✅ Service update completed');
      console.log('========== 🧭 PROPERTY CONTROLLER UPDATE END ==========\n');
      return response;
    } catch (error) {
      console.error('[PropertyController.update] ❌ Service update failed:', error);
      if (uploadedKeys.length) {
        await this.awsService.deleteMultipleFiles(uploadedKeys).catch(() => {});
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, SubscribedUserGuard)
  @Roles(UserRole.USER)
  @Delete(':id')
  remove(@Param() param: MongoIdDto, @CurrentUser() user: AuthUser) {
    return this.propertyService.remove(param.id, user);
  }

}

