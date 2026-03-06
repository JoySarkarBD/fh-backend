import { Injectable } from '@nestjs/common';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { Document } from 'src/schemas/document.schema';

@Injectable()
export class DocumentService {
  constructor(
    @InjectModel(Document.name) private readonly DocumentModel: Model<Document>,
    private readonly awsService: AwsService,
  ) {}

  /**
   * Create a new document record in the database.
   *
   * @param createDocumentDto - The data transfer object containing document details and URLs.
   * @returns A promise that resolves to the created document record.
   */
  async create(
    createDocumentDto: CreateDocumentDto & {
      docs: { key: string; documentUrl: string }[];
    },
    user: AuthUser,
  ) {
    const createDocument = new this.DocumentModel({
      ...createDocumentDto,
      createdBy: new Types.ObjectId(user.userId),
    });
    const result = await createDocument.save();

    // Generate signed URLs for each document (await all promises)
    // Use the saved document array from MongoDB to get _id
    const docsWithSignedUrls = await Promise.all(
      result.docs.map(async (doc: any) => ({
        _id: doc._id,
        documentUrl: await this.awsService.generateSignedUrl(doc.key),
      })),
    );

    return {
      ...result.toObject(),
      docs: docsWithSignedUrls,
    };
  }

  /**
   * Find all documents with pagination and optional filtering.
   *
   * @param query - An object containing pagination parameters (page, limit) and optional filters (e.g., propertyId).
   * @returns A promise that resolves to an object containing the list of documents and pagination metadata.
   * @throws {BadRequestException} If pagination parameters are invalid.
   */
  async findAll(query: Record<string, any>, user: AuthUser) {
    const { limit, page, propertyId } = query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    const filter: { createdBy: Types.ObjectId; propertyId?: string } = {
      createdBy: new Types.ObjectId(user.userId),
    };
    if (propertyId) filter.propertyId = propertyId;

    const docs = await this.DocumentModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limitNumber))
      .exec();

    const total = await this.DocumentModel.countDocuments(filter);

    return {
      data: docs,
      pagination: {
        total,
        page: Number(pageNumber),
        limit: Number(limitNumber),
        totalPages: Math.ceil(total / Number(limitNumber)),
        hasNextPage: Number(pageNumber) * Number(limitNumber) < total,
        hasPrevPage: Number(pageNumber) > 1,
      },
    };
  }

  findOne(id: number) {
    return `This action returns a #${id} document`;
  }

  update(id: number, updateDocumentDto: UpdateDocumentDto) {
    return `This action updates a #${id} document`;
  }

  remove(id: number) {
    return `This action removes a #${id} document`;
  }
}
