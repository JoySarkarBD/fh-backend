import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  UploadedFiles,
  Query,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { CreateDocumentDto } from './dto/create-document.dto';
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
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { RemoveDocumentItemDto } from './dto/remove-document-item.dto';

@Controller('document')
@UseGuards(JwtAuthGuard, RolesGuard, SubscribedUserGuard)
@Roles(UserRole.USER)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly awsService: AwsService,
  ) {}

  /**
   * Create a new document record.
   *
   * @param createDocumentDto - The data transfer object containing document details and URLs.
   * @param user - The authenticated user creating the document.
   * @param files - The uploaded document files.
   * @returns The created document record with signed URLs for the uploaded files.
   */
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

  /**
   * Find all documents with pagination and optional filtering.
   *
   * @param query - An object containing pagination parameters (page, limit) and optional filters (e.g., propertyId).
   * @param user - The authenticated user requesting the documents.
   * @returns A promise that resolves to an object containing the list of documents and pagination metadata.
   */
  @Get()
  async findAll(
    @Query() query: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.documentService.findAll(query, user);
  }

  /**
   * Find a document by ID.
   *
   * @param param - An object containing the document ID as a parameter.
   * @param user - The authenticated user requesting the document.
   * @returns A promise that resolves to the document record if found, or throws a NotFoundException if not found.
   */
  @Get(':id')
  async findOne(@Param() param: MongoIdDto, @CurrentUser() user: AuthUser) {
    return await this.documentService.findOne(param.id, user);
  }

  @Delete(':id/docs/:docId')
  async removeDoc(
    @Param() param: RemoveDocumentItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.documentService.removeDoc(param.id, param.docId, user);
  }
}
