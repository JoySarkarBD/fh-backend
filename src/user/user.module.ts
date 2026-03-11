import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Contact, ContactSchema } from 'src/schemas/contact.schema';
import { Payment, PaymentSchema } from 'src/schemas/payment.schema';
import { Property, PropertySchema } from 'src/schemas/property.schema';
import { User, UserSchema } from 'src/schemas/user.schema';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Property.name, schema: PropertySchema },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, JwtAuthGuard, RolesGuard],
})
export class UserModule {}
