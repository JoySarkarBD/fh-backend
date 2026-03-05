import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  create(@Body() createNotificationDto: CreateNotificationDto) {
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
  update(
    @Param() param: MongoIdDto,
    @Body() updateNotificationDto: UpdateNotificationDto,
  ) {
    return this.notificationService.update(param.id, updateNotificationDto);
  }

  @Delete(':id')
  remove(@Param() param: MongoIdDto) {
    return this.notificationService.remove(param.id);
  }
}
