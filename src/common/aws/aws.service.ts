import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class AwsService {
  private readonly logger = new Logger(AwsService.name);
  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    this.logger.log('AWS S3 Client Initialized');
  }

  /**
   * Generate public S3 URL
   */
  private getFileUrl(key: string): string {
    return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }

  /**
   * Upload small file
   */
  private async uploadSmall(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const extension = file.originalname.split('.').pop() || '';
    const fileName = `${uuidv4()}${extension ? '.' + extension : ''}`;

    const key = `${folder}/${fileName}`;

    try {
      const command = new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      });

      await this.s3Client.send(command);

      const url = this.getFileUrl(key);

      this.logger.log(`Small file uploaded → ${url}`);

      return url;
    } catch (error) {
      this.logger.error(`Small file upload failed`, error);
      throw error;
    }
  }

  /**
   * Upload large file (multipart upload)
   */
  private async uploadLarge(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const extension = file.originalname.split('.').pop() || '';
    const fileName = `${uuidv4()}${extension ? '.' + extension : ''}`;

    const key = `${folder}/${fileName}`;

    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: key,
          Body: file.buffer ?? file.stream,
          ContentType: file.mimetype || 'application/octet-stream',
        },
        queueSize: 4,
        partSize: 5 * 1024 * 1024,
      });

      upload.on('httpUploadProgress', (progress) => {
        this.logger.debug(
          `Uploading ${fileName} → ${progress.loaded}/${progress.total}`,
        );
      });

      await upload.done();

      const url = this.getFileUrl(key);

      this.logger.log(`Large file uploaded → ${url}`);

      return url;
    } catch (error) {
      this.logger.error(`Large file upload failed`, error);
      throw error;
    }
  }

  /**
   * Upload single file
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const SIZE_THRESHOLD = 20 * 1024 * 1024;

    try {
      if (file.size && file.size > SIZE_THRESHOLD) {
        this.logger.log(
          `Large file detected (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
        );

        return this.uploadLarge(file, folder);
      }

      return this.uploadSmall(file, folder);
    } catch (error) {
      this.logger.error(`Upload failed for ${file.originalname}`, error);
      throw error;
    }
  }

  /**
   * Upload multiple files
   */
  async uploadMultipleFiles(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<string[]> {
    try {
      this.logger.log(`Uploading ${files.length} files`);

      const uploadPromises = files.map((file) =>
        this.uploadFile(file, folder),
      );

      const urls = await Promise.all(uploadPromises);

      this.logger.log(`All files uploaded successfully`);

      return urls;
    } catch (error) {
      this.logger.error(`Multiple file upload failed`, error);
      throw error;
    }
  }

  /**
   * Delete single file by key
   */
  async deleteFile(key: string): Promise<void> {
    if (!key) throw new Error('No key provided for deletion');

    try {
      const command = new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: key,
      });

      await this.s3Client.send(command);

      this.logger.log(`File deleted successfully → ${key}`);
    } catch (error: any) {
      if (error.name !== 'NoSuchKey') {
        this.logger.error(`File deletion failed → ${key}`, error);
        throw error;
      }

      this.logger.warn(`File not found → ${key}`);
    }
  }

  /**
   * Delete multiple files
   */
  async deleteMultipleFiles(keys: string[]): Promise<void> {
    if (!keys?.length) return;

    try {
      const chunks = this.chunkArray(keys, 1000);

      for (const chunk of chunks) {
        const command = new DeleteObjectsCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        });

        await this.s3Client.send(command);
      }

      this.logger.log(`${keys.length} files deleted successfully`);
    } catch (error) {
      this.logger.error(`Bulk delete failed`, error);
      throw error;
    }
  }

  /**
   * Extract S3 key from URL
   */
  extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const key = urlObj.pathname.substring(1);

      this.logger.debug(`Extracted key → ${key}`);

      return key;
    } catch {
      this.logger.warn(`Invalid S3 URL → ${url}`);
      return null;
    }
  }

  /**
   * Generate Signed URL for a file (expires in 1 week)
   */
  async generateSignedUrl(key: string): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: key,
      });

      // 7 days in seconds
      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: 7 * 24 * 60 * 60,
      });

      this.logger.log(`Signed URL generated → ${url}`);

      return url;
    } catch (error) {
      this.logger.error(`Signed URL generation failed → ${key}`, error);
      throw error;
    }
  }


  /**
   * Helper to chunk array
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }

    return chunks;
  }
}