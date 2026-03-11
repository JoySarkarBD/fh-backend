/**
 * @fileoverview DTO for the cursor-paginated chat history REST endpoint.
 *
 * GET /api/chat/messages?conversationId=xxx&cursor=ISO&limit=20
 */

import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsISO8601,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GetMessagesDto {
  /**
   * The conversation whose history to load.
   */
  @IsMongoId()
  @IsNotEmpty()
  conversationId!: string;

  /**
   * Cursor for pagination — ISO-8601 timestamp of the oldest message
   * from the PREVIOUS page response (`nextCursor` field).
   *
   * Omit on the first request to get the most recent messages.
   * On subsequent requests pass the `nextCursor` from the last response
   * to load older messages (scroll-up behaviour).
   */
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  /**
   * Number of messages to return per page.
   * Defaults to 20, maximum 50.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  @Transform(({ value }) => Number(value))
  limit?: number = 20;
}
