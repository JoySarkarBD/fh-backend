import { Prop, Schema } from '@nestjs/mongoose';

export enum NotificationType {
  ALERT = 'ALERT', //*When a property matching their saved search criteria is listed.
  REMINDER = 'REMINDER', //*For upcoming open houses they registered for.
  ACTIVITY = 'ACTIVITY', //*When a favorites property is sold, rented, or desisted.
  LIVE = 'LIVE', // *When their property is published on the site/portal.
  MARKET = 'MARKET', //*Weekly/monthly digest emails with new listings and market trends.
  DOCUMENT_REMINDERS = 'DOCUMENT_REMINDERS', //*For lease agreements, inspection reports, etc.
  USER_REPORT = 'USER_REPORT', //*New user registrations, flagged accounts, suspicious activity.
  MODERATION = 'MODERATION', //*New listings pending approval, flagged listings.
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, ref: 'User' })
  receiver!: string;

  @Prop({ required: false, ref: 'User' })
  sender?: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ enum: NotificationType })
  type?: NotificationType;

  @Prop({ required: false })
  redirectLink?: string;
}
