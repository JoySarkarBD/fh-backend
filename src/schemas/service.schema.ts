import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ServiceDocument = HydratedDocument<Service>;

// Sub-document schema for service description items
@Schema({ _id: true, versionKey: false })
export class ServiceDescription {
  @Prop({ required: true, trim: true })
  text!: string;
}

export const ServiceDescriptionSchema =
  SchemaFactory.createForClass(ServiceDescription);

// Main schema for the Service collection
@Schema({ timestamps: true, versionKey: false })
export class Service {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  subTitle!: string;

  @Prop({
    type: [ServiceDescriptionSchema],
    required: true,
    validate: {
      validator: (items: ServiceDescription[]) => items.length <= 4,
      message: 'Maximum 4 description items are allowed',
    },
  })
  description!: ServiceDescription[];
}

export const ServiceSchema = SchemaFactory.createForClass(Service);
