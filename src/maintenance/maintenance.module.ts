import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceController } from './maintenance.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Maintenance, MaintenanceSchema } from 'src/schemas/maintenance.schema';
import { User, UserSchema } from 'src/schemas/user.schema';
import { SubscribedUserGuard } from 'src/auth/guards/subscribed-user.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Maintenance.name,
        schema: MaintenanceSchema,
      },
      {
        name: User.name,
        schema: UserSchema,
      },
    ]),
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, SubscribedUserGuard],
})
export class MaintenanceModule {}
