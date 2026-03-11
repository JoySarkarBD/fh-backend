/**
 * @fileoverview DTO for the cursor-paginated conversation list endpoint.
 *
 * GET /api/chat/conversations?cursor=<ISO>&limit=20
 *
 * Cursor = ISO-8601 `lastMessageAt` of the oldest conversation from the
 * previous page.  Omit on the first request to get the most-recent 20.
 */

import {
  IsOptional,
  IsISO8601,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GetConversationsDto {
  /**
   * Cursor for pagination — pass the `nextCursor` value returned by the
   * previous page to load the next batch of older conversations.
   *
   * Omit (or leave empty) on the first request.
   */
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  /**
   * Number of conversations per page.
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
