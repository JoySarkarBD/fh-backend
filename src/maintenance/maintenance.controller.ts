import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/schemas/user.schema';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard, SubscribedUserGuard)
@Roles(UserRole.USER)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() createMaintenanceDto: CreateMaintenanceDto,
  ) {
    return this.maintenanceService.create(user.userId, createMaintenanceDto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.maintenanceService.findAll(user.userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param() param: MongoIdDto) {
    return this.maintenanceService.findOne(param.id, user.userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param() param: MongoIdDto,
    @Body() updateMaintenanceDto: UpdateMaintenanceDto,
  ) {
    return this.maintenanceService.update(
      param.id,
      user.userId,
      updateMaintenanceDto,
    );
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param() param: MongoIdDto) {
    return this.maintenanceService.remove(param.id, user.userId);
  }
}
