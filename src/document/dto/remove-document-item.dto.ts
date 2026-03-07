import { IsMongoId } from 'class-validator';

export class RemoveDocumentItemDto {
  @IsMongoId()
  id: string;

  @IsMongoId()
  docId: string;
}
