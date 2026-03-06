import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateNotificationSettingDto } from './dto/create-notification-setting.dto';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { NotificationSettingsService } from './notification-settings.service';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(
    private readonly notificationSettingsService: NotificationSettingsService,
  ) {}

  @Get()
  findAll() {
    return this.notificationSettingsService.findAll();
  }

  @Get(':id')
  findOne(@Param() param: MongoIdDto) {
    return this.notificationSettingsService.findOne(param.id);
  }

  @Patch(':id')
  update(
    @Param() param: MongoIdDto,
    @Body() updateNotificationSettingDto: UpdateNotificationSettingDto,
  ) {
    return this.notificationSettingsService.update(
      param.id,
      updateNotificationSettingDto,
    );
  }
}
