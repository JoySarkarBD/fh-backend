import { IsMongoId } from 'class-validator';

export class MongoIdDto {
  @IsMongoId({ message: 'Invalid MongoDB ObjectId' })
  id!: string;
}

export class UserIdDto {
  @IsMongoId({ message: 'Invalid MongoDB ObjectId' })
  userId!: string;
}
