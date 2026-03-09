import { IsMongoId } from 'class-validator';

export class ForwardMessageDto {
  @IsMongoId()
  targetConversationId!: string;
}
