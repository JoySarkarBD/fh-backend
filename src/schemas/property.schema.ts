import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PropertyDocument = HydratedDocument<Property>;

export enum PropertyStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  BAN = 'ban',
}

/**
 * Image Sub Schema
 */
@Schema()
export class ImageItem {
  @Prop({ required: true })
  key!: string; // s3 object key

  @Prop({ required: true })
  image!: string;
}

export const ImageItemSchema = SchemaFactory.createForClass(ImageItem);

/**
 * Property Schema
 */
@Schema({ timestamps: true })
export class Property {
  /**
   * Property Name
   */
  @Prop({ required: true, trim: true })
  propertyName!: string;

  /**
   * Property Status
   */
  @Prop({
    required: true,
    enum: PropertyStatus,
    default: PropertyStatus.ACTIVE,
  })
  status!: PropertyStatus;

  /**
   * Overview (QuillJS HTML)
   */
  @Prop({ required: true })
  overview!: string;

  /**
   * Key Features (QuillJS HTML)
   */
  @Prop({ required: true })
  keyFeatures!: string;

  /**
   * Bedrooms
   */
  @Prop({ required: true, min: 0 })
  bedrooms!: number;

  /**
   * Bathrooms
   */
  @Prop({ required: true, min: 0 })
  bathrooms!: number;

  /**
   * Square Feet
   */
  @Prop({ required: true, min: 0 })
  squareFeet!: number;

  /**
   * Lot Size
   */
  @Prop({ min: 0 })
  lotSize!: number;

  /**
   * Price
   */
  @Prop({ required: true, min: 0 })
  price!: number;

  /**
   * Year Built
   */
  @Prop({
    required: true,
    min: 1800,
    max: new Date().getFullYear(),
  })
  yearBuilt!: number;

  /**
   * More Details (QuillJS HTML)
   */
  @Prop({ required: true })
  moreDetails!: string;

  /**
   * Location Map Link
   */
  @Prop({ default: '' })
  locationMapLink!: string;

  /**
   * Publish Status
   */
  @Prop({ default: false })
  isPublished!: boolean;

  /**
   * Schedule publish datetime
   */
  @Prop({ type: Date })
  sellScheduleAt!: Date;

  /**
   * Property Images
   */
  @Prop({
    type: [ImageItemSchema],
  })
  images!: ImageItem[];

  /**
   * Thumbnail Image
   */
  @Prop({
    type: ImageItemSchema,
    required: true,
  })
  thumbnail!: ImageItem;

  /**
   * Property Owner
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  propertyOwner!: Types.ObjectId;
}

export const PropertySchema = SchemaFactory.createForClass(Property);
