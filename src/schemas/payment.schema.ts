import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true, versionKey: false })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true, default: 99 })
  amount!: number;

  @Prop({ required: true, default: 'usd', lowercase: true, trim: true })
  currency!: string;

  @Prop({ required: true, enum: PaymentStatus, default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @Prop({ required: true, trim: true, unique: true })
  transactionId!: string;

  @Prop({ required: false, trim: true })
  stripeCheckoutSessionId?: string;

  @Prop({ required: false, trim: true })
  stripePaymentIntentId?: string;

  @Prop({ default: false })
  lifetimeAccessGranted!: boolean;

  @Prop({ type: Date, required: false })
  paidAt?: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
