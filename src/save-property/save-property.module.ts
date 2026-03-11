import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { Property, PropertySchema } from 'src/schemas/property.schema';
import {
  SaveProperty,
  SavePropertySchema,
} from 'src/schemas/save-property.schema';
import { User, UserSchema } from 'src/schemas/user.schema';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';
import { SavePropertyController } from './save-property.controller';
import { SavePropertyService } from './save-property.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SaveProperty.name, schema: SavePropertySchema },
      { name: Property.name, schema: PropertySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SavePropertyController],
  providers: [SavePropertyService, AwsService, SubscribedUserGuard],
})
export class SavePropertyModule {}
