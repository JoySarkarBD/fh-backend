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
import { ServiceService } from './service.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/schemas/user.schema';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

@Controller('service')
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  /**
   * Create a new service
   *
   * @param createServiceDto - An object containing the details of the service to be created, such as name, description, price, etc. This data is expected to be validated against the CreateServiceDto class before being passed to this method.
   * @returns The newly created service document from the database, which includes all the details of the service along with its unique identifier (_id) and timestamps (createdAt, updatedAt).
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('create')
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.serviceService.create(createServiceDto);
  }

  /**
   * Fetch all services from the database
   *
   * @returns An array of service documents, each containing the details of a service along with its unique identifier (_id) and timestamps (createdAt, updatedAt). The services are sorted in descending order based on their creation date.
   */
  @Get('many')
  findAll(@Query() query: PaginationDto) {
    return this.serviceService.findAll(query);
  }

  /**
   * Fetch a single service by its unique identifier (_id)
   *
   * @param id - The unique identifier of the service to be fetched. This is expected to be a valid MongoDB ObjectId string.
   * @returns The service document with the matching unique identifier, or throws a NotFoundException if no such service exists.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param() param: MongoIdDto) {
    return this.serviceService.findOne(param.id);
  }

  /**
   * Update an existing service by its unique identifier (_id)
   *
   * @param id - The unique identifier of the service to be updated. This is expected to be a valid MongoDB ObjectId string.
   * @param updateServiceDto - An object containing the updated details of the service. This data is expected to be validated against the UpdateServiceDto class before being passed to this method.
   * @returns The updated service document from the database, which includes all the updated details of the service along with its unique identifier (_id) and timestamps (createdAt, updatedAt).
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @Param() param: MongoIdDto,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.serviceService.update(param.id, updateServiceDto);
  }

  /**
   * Delete a service by its unique identifier (_id)
   *
   * @param id - The unique identifier of the service to be deleted. This is expected to be a valid MongoDB ObjectId string.
   * @returns A message confirming the successful deletion of the service, or throws a NotFoundException if no such service exists.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param() param: MongoIdDto) {
    return this.serviceService.remove(param.id);
  }
}
