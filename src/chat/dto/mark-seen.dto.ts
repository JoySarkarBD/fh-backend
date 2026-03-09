import { IsMongoId } from 'class-validator';

export class MarkSeenDto {
  @IsMongoId()
  conversationId!: string;
}
