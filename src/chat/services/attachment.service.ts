import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { Message, MessageDocument } from 'src/schemas/message.schema';

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    private readonly awsService: AwsService,
  ) {}

  /**
   * Upload an attachment to S3
   */
  async uploadAttachment(file: Express.Multer.File, folder: string = 'chat-attachments'): Promise<string> {
    return this.awsService.uploadFile(file, folder);
  }

  /**
   * Checks how many times a given S3 key is referenced in the messages collection.
   * Useful for forwarded messages that reuse the same attachment.
   */
  async checkAttachmentReferenceCount(key: string): Promise<number> {
    return this.messageModel.countDocuments({
      'attachments.key': key,
    });
  }

  /**
   * Deletes an attachment from S3 ONLY if no other messages are referencing it.
   */
  async deleteAttachmentIfUnused(key: string): Promise<void> {
    const count = await this.checkAttachmentReferenceCount(key);
    
    // count === 0 means no messages currently have this attachment
    if (count === 0) {
      try {
        await this.awsService.deleteFile(key);
        this.logger.log(`Deleted unused attachment from S3: ${key}`);
      } catch (error) {
        this.logger.error(`Failed to delete unused attachment ${key}`, error);
      }
    } else {
      this.logger.log(`Attachment ${key} is still referenced by ${count} message(s). Not deleting from S3.`);
    }
  }
}
