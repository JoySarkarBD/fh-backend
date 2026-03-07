import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NotificationSettings,
  NotificationSettingSchema,
} from 'src/schemas/notification.settings.schema';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: NotificationSettings.name,
        schema: NotificationSettingSchema,
      },
    ]),
  ],
  controllers: [NotificationSettingsController],
  providers: [NotificationSettingsService],
})
export class NotificationSettingsModule {}
