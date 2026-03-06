import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { NotificationType } from './notification.schema';

export enum NotificationSettingsTitle {
  ALERT = 'New Listing Alerts',
  REMINDER = 'Open House Reminders', //*For upcoming open houses they registered for.
  ACTIVITY = 'Favorites Activity', //*When a favorites property is sold, rented, or desisted.
  LIVE = 'Listing Live Notification', // *When their property is published on the site/portal.
  MARKET = 'Market Updates', //*Weekly/monthly digest emails with new listings and market trends.
  DOCUMENT_REMINDERS = 'Document Submission Reminders', //*For lease agreements, inspection reports, etc.
  USER_REPORT = 'User Reports', //*New user registrations, flagged accounts, suspicious activity.
  MODERATION = 'Listing Moderation', //*New listings pending approval, flagged listings.
}
@Schema({ timestamps: true })
export class NotificationSettings {
  @Prop({ required: true, unique: true })
  name!: NotificationType;

  @Prop({ required: true, unique: true })
  title!: string;

  @Prop({ required: true })
  isActive!: boolean;

  @Prop({ required: true })
  description!: string;
}
export const NotificationSettingSchema =
  SchemaFactory.createForClass(NotificationSettings);
