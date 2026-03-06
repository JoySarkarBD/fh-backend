import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MaintenanceStatus } from 'src/schemas/maintenance.schema';

export class CreateMaintenanceDto {
  @IsString({ message: 'Amenities must be a string' })
  @IsNotEmpty({ message: 'Amenities is required & must be a string' })
  amenities: string;

  @IsString({ message: 'Task must be a string' })
  @IsNotEmpty({ message: 'Task is required & must be a string' })
  task: string;

  @IsNotEmpty({ message: 'Reminder date is required' })
  reminderDate: Date;

  @IsString({ message: 'Description must be a string' })
  @IsNotEmpty({ message: 'Description is required & must be a string' })
  description: string;

  @IsOptional()
  @IsEnum(MaintenanceStatus, { message: 'Status must be PENDING or DONE' })
  status?: MaintenanceStatus;
}
