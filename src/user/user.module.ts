import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User, UserSchema } from 'src/schemas/user.schema';
import { Payment, PaymentSchema } from 'src/schemas/payment.schema';
import { Contact, ContactSchema } from 'src/schemas/contact.schema';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AwsModule } from 'src/common/aws/aws.module';

@Module({
  imports: [
    AwsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, JwtAuthGuard, RolesGuard],
})
export class UserModule {}
