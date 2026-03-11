import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';
import { AwsService } from 'src/common/aws/aws.service';
import { Property, PropertySchema } from 'src/schemas/property.schema';
import { User, UserSchema } from 'src/schemas/user.schema';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Property.name, schema: PropertySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PropertyController],
  providers: [PropertyService, SubscribedUserGuard, AwsService],
})
export class PropertyModule {}
