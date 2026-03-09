/**
 * @fileoverview DTO for sending a new chat message over WebSocket.
 *
 * This is the payload validated when the client emits the `sendMessage`
 * event on the WebSocket gateway.
 */

import {
  IsString,
  IsNotEmpty,
  IsMongoId,
  IsOptional,
  IsArray,
  IsUrl,
  MaxLength,
  ArrayMaxSize,
  IsNumber,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SendAttachmentDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsUrl()
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsNumber()
  size!: number;

  @IsMongoId()
  @IsNotEmpty()
  uploadedBy!: string;

  @IsString()
  @IsNotEmpty()
  createdAt!: string;
}

export class SendMessageDto {
  /**
   * MongoDB ObjectId of the conversation this message belongs to.
   * Must be created via POST /api/chat/conversations first.
   */
  @IsMongoId()
  @IsNotEmpty()
  conversationId!: string;

  /**
   * The text body of the message.
   * Limited to 5000 characters to prevent oversized payloads.
   * Empty string allowed when sending attachment-only messages.
   */
  @IsString()
  @MaxLength(5000)
  message!: string;

  /**
   * Optional list of pre-uploaded attachment objects.
   * Maximum 10 attachments per message.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendAttachmentDto)
  @ArrayMaxSize(10)
  attachments?: SendAttachmentDto[];

  @IsOptional()
  @IsBoolean()
  isForwarded?: boolean;

  @IsOptional()
  @IsMongoId()
  originalMessageId?: string;

  @IsOptional()
  @IsMongoId()
  forwardedBy?: string;
}
