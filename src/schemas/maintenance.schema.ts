import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MaintenanceDocument = HydratedDocument<Maintenance>;

// status type
export enum MaintenanceStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
}

@Schema({ timestamps: true, versionKey: false })
export class Maintenance {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  amenities!: string;

  @Prop({ required: true, trim: true })
  task!: string;

  @Prop({ required: true, trim: true })
  reminderDate!: Date;

  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ enum: MaintenanceStatus, default: MaintenanceStatus.PENDING })
  status!: MaintenanceStatus;
}

export const MaintenanceSchema = SchemaFactory.createForClass(Maintenance);
