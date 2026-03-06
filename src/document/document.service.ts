import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateDocumentDto } from './dto/create-document.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { Document } from 'src/schemas/document.schema';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

@Injectable()
export class DocumentService {
  constructor(
    @InjectModel(Document.name) private readonly DocumentModel: Model<Document>,
    private readonly awsService: AwsService,
  ) {}

  private async mapDocumentResponse(document: any) {
    return {
      ...document.toObject(),
      propertyName: document.propertyId?.propertyName,
      propertyId:
        typeof document.propertyId === 'object' && document.propertyId?._id
          ? document.propertyId._id
          : document.propertyId,
      docs: await Promise.all(
        (document.docs || []).map(async (doc: any) => ({
          _id: doc._id,
          documentUrl: await this.awsService.generateSignedUrl(doc.key),
        })),
      ),
    };
  }

  async findOneOwnedRaw(id: MongoIdDto['id'], user: AuthUser) {
    const document = await this.DocumentModel.findOne({
      _id: id,
      createdBy: new Types.ObjectId(user.userId),
    }).exec();

    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }

    return document;
  }

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
    // Check if the propertyId exists in documents
    const existing = await this.DocumentModel.findOne({
      propertyId: new Types.ObjectId(createDocumentDto.propertyId),
      createdBy: new Types.ObjectId(user.userId),
    }).exec();

    if (existing) {
      // now add documents to the existing document record
      const updatedDocs = [
        ...(existing.docs || []),
        ...(createDocumentDto.docs || []),
      ];
      existing.docs = updatedDocs;

      const result = await existing.save();

      return {
        ...result.toObject(),
        docs: await Promise.all(
          result.docs.map(async (doc: any) => ({
            _id: doc._id,
            documentUrl: await this.awsService.generateSignedUrl(doc.key),
          })),
        ),
      };
    }

    const createDocument = new this.DocumentModel({
      ...createDocumentDto,
      propertyId: new Types.ObjectId(createDocumentDto.propertyId),
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
      .populate('propertyId', 'propertyName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limitNumber))
      .exec();

    const total = await this.DocumentModel.countDocuments(filter);

    return {
      data: await Promise.all(docs.map((doc) => this.mapDocumentResponse(doc))),
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

  /**
   *
   * Find a single document by its ID.
   *
   * @param id - The ID of the document to retrieve.
   * @returns A promise that resolves to the document record if found, or null if not found.
   * @throws {BadRequestException} If the provided ID is invalid.
   */
  async findOne(id: MongoIdDto['id'], user: AuthUser) {
    const document = await this.DocumentModel.findOne({
      _id: id,
      createdBy: new Types.ObjectId(user.userId),
    }).exec();
    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    return this.mapDocumentResponse(document);
  }

  async removeDoc(
    id: MongoIdDto['id'],
    docId: MongoIdDto['id'],
    user: AuthUser,
  ) {
    const existing = await this.DocumentModel.findOne({
      _id: id,
      createdBy: new Types.ObjectId(user.userId),
    }).exec();

    if (!existing) {
      throw new NotFoundException(
        `Document with ID ${id} not found or not owned by user`,
      );
    }

    const targetDoc = (existing.docs || []).find(
      (doc: any) => String(doc._id) === String(docId),
    );

    if (!targetDoc) {
      throw new NotFoundException(
        `Document item with ID ${docId} not found for document ${id}`,
      );
    }

    if (targetDoc.key) {
      await this.awsService.deleteFile(targetDoc.key);
    }

    await this.DocumentModel.updateOne(
      { _id: id, createdBy: new Types.ObjectId(user.userId) },
      { $pull: { docs: { _id: new Types.ObjectId(docId) } } },
    ).exec();

    return { message: 'Document file deleted successfully' };
  }
}
