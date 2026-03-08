import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Headers,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { PaymentService } from './payment.service';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/schemas/user.schema';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-checkout-session')
  async createCheckoutSession(@Body('userId') userId: string) {
    return this.paymentService.createCheckoutSession(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Post()
  create(@CurrentUser() user: AuthUser) {
    return this.paymentService.create(user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Get('my-history')
  findMyHistory(@CurrentUser() user: AuthUser) {
    return this.paymentService.findMyHistory(user);
  }

  @Get()
  findAll() {
    return this.paymentService.findAll();
  }

  @Get(':id')
  findOne(@Param() param: MongoIdDto) {
    return this.paymentService.findOne(param.id);
  }
}
