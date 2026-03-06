import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum ArticleCategory {
  SELLING_TIPS = 'SELLING_TIPS',
  BUYING_GUIDE = 'BUYING_GUIDE',
  MARKET_ANALYSIS = 'MARKET_ANALYSI',
}
/**
 * Image Sub Schema
 */
@Schema({ _id: false })
export class ImageItem {
  @Prop({ required: true })
  key!: string; // s3 object key

  @Prop({ required: true })
  image!: string;
}

export const ImageItemSchema = SchemaFactory.createForClass(ImageItem);

@Schema({ timestamps: true })
export class Article {
  @Prop({
    type: ImageItemSchema,
    required: true,
  })
  image!: ImageItem;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: false })
  publishDate?: string;

  @Prop({ required: true })
  blogDetails!: string;

  @Prop({ required: true })
  category!: ArticleCategory;

  @Prop({ required: true, ref: 'User' })
  createdBy!: Types.ObjectId;
}

export const ArticleSchema = SchemaFactory.createForClass(Article);
