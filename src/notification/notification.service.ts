import { Injectable } from '@nestjs/common';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
@Injectable()
export class NotificationService {
  create(createNotificationDto) {
    return 'This action adds a new notification';
  }

  findAll() {
    return `This action returns all notification`;
  }

  findOne(id: MongoIdDto['id']) {
    return `This action returns a #${id} notification`;
  }

  update(id: MongoIdDto['id'], updateNotificationDto) {
    return `This action updates a #${id} notification`;
  }

  remove(id: MongoIdDto['id']) {
    return `This action removes a #${id} notification`;
  }
}
 