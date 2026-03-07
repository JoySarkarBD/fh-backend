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
import type { Express } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';
import { AwsService } from 'src/common/aws/aws.service';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { UserRole } from 'src/schemas/user.schema';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyService } from './property.service';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

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

    return this.propertyService.create(dtoWithFiles, user);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: Record<string, any>) {
    console.log(user);
    return this.propertyService.findAll(user, query);
  }
  @UseGuards(JwtAuthGuard, SubscribedUserGuard)
  @Get('me')
  findAllOwnProperty(@CurrentUser() user: AuthUser, @Query() query: Record<string, any>) {
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
  update(
    @Param() param: MongoIdDto,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.propertyService.update(param.id, updatePropertyDto, user);
  }

  @UseGuards(JwtAuthGuard, SubscribedUserGuard)
  @Roles(UserRole.USER)
  @Delete(':id')
  remove(@Param() param: MongoIdDto, @CurrentUser() user: AuthUser) {
    return this.propertyService.remove(param.id, user);
  }
}
