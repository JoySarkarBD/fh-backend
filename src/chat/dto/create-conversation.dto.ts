/**
 * @fileoverview DTO for creating a new conversation via REST API.
 *
 * POST /api/chat/conversations
 *
 * The current authenticated user is always added as a participant
 * server-side, so `participantIds` should only contain the OTHER
 * user(s) to add.
 */

import {
  IsArray,
  IsMongoId,
  ArrayMinSize,
  ArrayMaxSize,
  IsOptional,
} from 'class-validator';

export class CreateConversationDto {
  /**
   * Array of User ObjectId strings to include in the conversation.
   * Do NOT include your own userId — it is added automatically.
   *
   * For 1-on-1 chat: pass exactly 1 participantId.
   * For group chat: pass multiple participantIds (max 49 others → 50 total).
   */
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  participantIds!: string[];

  @IsOptional()
  @IsMongoId()
  propertyId?: string;
}
