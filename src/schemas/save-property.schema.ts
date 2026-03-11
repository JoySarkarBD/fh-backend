import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SavePropertyDocument = HydratedDocument<SaveProperty>;

@Schema({ timestamps: true })
export class SaveProperty {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Property',
    required: true,
    index: true,
  })
  propertyId!: Types.ObjectId;
}

export const SavePropertySchema = SchemaFactory.createForClass(SaveProperty);

SavePropertySchema.index({ userId: 1, propertyId: 1 }, { unique: true });
