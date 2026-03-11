import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { NotificationSettings } from 'src/schemas/notification.settings.schema';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';

@Injectable()
export class NotificationSettingsService {
  constructor(
    @InjectModel(NotificationSettings.name)
    private readonly notificationSettingModel: Model<NotificationSettings>,
  ) {}

  // async create(createNotificationSettingDto: CreateNotificationSettingDto) {
  //   const newNotificationSetting = new this.notificationSettingModel(
  //     createNotificationSettingDto,
  //   );
  //   const created = await newNotificationSetting.save();
  //   return created;
  // }

  // find all notificaiton

  async findAll() {
    const notifications = await this.notificationSettingModel.find();
    return notifications;
  }

  // get single notificaiton detiails if needed
  async findOne(id: MongoIdDto['id']) {
    const notificationSetting = await this.notificationSettingModel.findOne({
      _id: id,
    });
    return notificationSetting;
  }

  async update(
    id: MongoIdDto['id'],
    updateNotificationSettingDto: UpdateNotificationSettingDto,
  ) {
    const updated = await this.notificationSettingModel.updateOne(
      { _id: id },
      { $set: updateNotificationSettingDto },
    );
    return updated;
  }

  // remove(id: number) {
  //   return `This action removes a #${id} notificationSetting`;
  // }
}
