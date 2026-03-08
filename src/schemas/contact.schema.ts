import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContactDocument = HydratedDocument<Contact>;

export enum ContactStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
}

@Schema({ timestamps: true, versionKey: false })
export class Contact {
  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ required: true, trim: true })
  lastName!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email!: string;

  @Prop({ required: true, trim: true })
  message!: string;

  @Prop({ required: true, enum: ContactStatus, default: ContactStatus.PENDING })
  status!: ContactStatus;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
