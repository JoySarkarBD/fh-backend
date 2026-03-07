import { IsBoolean, IsEnum, IsString } from 'class-validator';
import { NotificationType } from 'src/schemas/notification.schema';
import { NotificationSettingsTitle } from 'src/schemas/notification.settings.schema';

export class CreateNotificationSettingDto {
  @IsEnum(NotificationType, {
    message: `Name must be one of: ${Object.values(NotificationType).join(', ')}`,
  })
  name!: NotificationType;

  @IsBoolean({ message: 'IsActive Must be boolean' })
  isActive!: boolean;

  @IsEnum(NotificationSettingsTitle, {
    message: 'Notification title is required',
  })
  title!: NotificationSettingsTitle;

  @IsString({ message: 'Description is required' })
  description!: string;
}
