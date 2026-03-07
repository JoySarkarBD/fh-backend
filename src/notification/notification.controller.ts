import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { NotificationService } from './notification.service';
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  create(@Body() createNotificationDto: any) {
    return this.notificationService.create(createNotificationDto);
  }

  @Get()
  findAll() {
    return this.notificationService.findAll();
  }

  @Get(':id')
  findOne(@Param() param: MongoIdDto) {
    return this.notificationService.findOne(param.id);
  }

  @Patch(':id')
  update(@Param() param: MongoIdDto, @Body() updateNotificationDto: any) {
    return this.notificationService.update(param.id, updateNotificationDto);
  }

  @Delete(':id')
  remove(@Param() param: MongoIdDto) {
    return this.notificationService.remove(param.id);
  }
}
