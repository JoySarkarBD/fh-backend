import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Schema({ timestamps: true, versionKey: false })
export class User {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email!: string;

  @Prop({ trim: true, unique: true, sparse: true })
  googleId?: string;

  // user role can be either USER or ADMIN, default is USER
  @Prop({ enum: UserRole, default: UserRole.USER })
  role?: UserRole;

  @Prop({ trim: true })
  // can upload image as file or provide image url
  profileImage?: string;

  @Prop({ required: false, unique: true, sparse: true, trim: true })
  phone?: string;

  @Prop({ required: false, trim: true })
  homeAddress?: string;

  @Prop({ required: false, trim: true })
  officeAddress?: string;

  @Prop({ required: false, trim: true })
  homePhone?: string;

  @Prop({ required: false, trim: true })
  officePhone?: string;

  @Prop({ required: false, select: false })
  password?: string;

  @Prop({ trim: true })
  websiteLink?: string;

  @Prop({ trim: true })
  facebookLink?: string;

  @Prop({ trim: true })
  instagramLink?: string;

  @Prop({ trim: true })
  twitterLink?: string;

  @Prop({ trim: true })
  linkedinLink?: string;

  @Prop({ default: false })
  isSuspended?: boolean;

  @Prop({ trim: true, default: false })
  isSubscribed?: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
