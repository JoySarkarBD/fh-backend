import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  UploadedFiles,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { AwsService } from 'src/common/aws/aws.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';
import { UserRole } from 'src/schemas/user.schema';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/common/interface/auth-user.interface';

@Controller('document')
@UseGuards(JwtAuthGuard, RolesGuard, SubscribedUserGuard)
@Roles(UserRole.USER)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly awsService: AwsService,
  ) {}

  @Post()
  // Image upload handling with validation
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'docs', maxCount: 8 }], {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        // it can be image, docx, pdf, pptx, xlsx
        if (
          !file.mimetype.startsWith('image/') &&
          !file.mimetype.endsWith('docx') &&
          !file.mimetype.endsWith('pdf') &&
          !file.mimetype.endsWith('pptx') &&
          !file.mimetype.endsWith('xlsx')
        ) {
          return cb(
            new BadRequestException(
              'Only image, docx, pdf, pptx, and xlsx files are allowed',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async create(
    @Body() createDocumentDto: CreateDocumentDto,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: { docs?: Express.Multer.File[] },
  ) {
    const docs = files?.docs || [];
    if (!docs) {
      throw new BadRequestException('No document files uploaded');
    }

    // upload files to AWS S3 and get their URLs
    const documentUrls = await this.awsService.uploadMultipleFiles(
      docs,
      `docs/${user.userId}/${createDocumentDto.propertyId}`,
    );

    const dtoWithFiles = {
      ...createDocumentDto,
      docs: documentUrls.map((url) => ({
        key: this.awsService.extractKeyFromUrl
          ? (this.awsService.extractKeyFromUrl(url) ?? url)
          : url,
        documentUrl: url,
      })),
    };
    try {
      return await this.documentService.create(dtoWithFiles, user);
    } catch (error) {
      // Rollback: delete uploaded files from S3 if DB save fails
      const keys = dtoWithFiles.docs.map((doc) => doc.key);
      await this.awsService.deleteMultipleFiles(keys).catch(() => {});
      throw error;
    }
  }

  @Get()
  findAll() {
    return this.documentService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
  ) {
    return this.documentService.update(+id, updateDocumentDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentService.remove(+id);
  }
}
