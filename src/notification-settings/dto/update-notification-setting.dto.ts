import { IsBoolean } from 'class-validator';

export class UpdateNotificationSettingDto {
  @IsBoolean({ message: 'IsActive Must be boolean' })
  isActive!: boolean;
}
