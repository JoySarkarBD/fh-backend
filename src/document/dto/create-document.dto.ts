import { IsMongoId } from 'class-validator';

export class CreateDocumentDto {
  @IsMongoId({ message: 'Property ID must be a valid mongodb' })
  propertyId: string;
}
