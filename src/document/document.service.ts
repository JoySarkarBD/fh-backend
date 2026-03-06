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

  findAll() {
    return `This action returns all document`;
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
