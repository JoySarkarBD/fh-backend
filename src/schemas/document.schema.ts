import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema()
export class DocumentItem {
  @Prop({ required: true })
  key: string; // s3 object key

  @Prop({ required: true })
  documentUrl: string;
}

export const DocumentItemSchema = SchemaFactory.createForClass(DocumentItem);

@Schema({ timestamps: true })
export class Document {
  @Prop({ required: true, ref: 'Property' })
  propertyId!: Types.ObjectId;

  @Prop({
    type: [DocumentItemSchema],
    required: true,
  })
  docs!: DocumentItem[];

  @Prop({ ref: 'User' })
  createdBy?: Types.ObjectId;
}
export const DocumentSchema = SchemaFactory.createForClass(Document);
