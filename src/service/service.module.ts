import { Module } from '@nestjs/common';
import { ServiceController } from './service.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Service, ServiceSchema } from 'src/schemas/service.schema';
import { ServiceService } from './service.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Service.name,
        schema: ServiceSchema,
      },
    ]),
  ],
  controllers: [ServiceController],
  providers: [ServiceService, JwtAuthGuard, RolesGuard],
})
export class ServiceModule {}
