import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Service, ServiceDocument } from 'src/schemas/service.schema';
import { Model, Types } from 'mongoose';
import { PaginatedMetaDto, PaginationDto } from 'src/common/dto/pagination.dto';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

@Injectable()
export class ServiceService {
  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
  ) {}

  /**
   * Create a new service
   *
   * @param createServiceDto - Data Transfer Object containing the details of the service to be created, such as name, description, price, etc. This DTO is expected to be validated against the CreateServiceDto class.
   * @returns The newly created service document from the database, which includes all the details of the service along with its unique identifier (_id) and timestamps (createdAt, updatedAt).
   * @throws BadRequestException if the provided data is invalid or fails validation checks defined in the CreateServiceDto class.
   * @throws InternalServerErrorException if there is an error while saving the service to the database.
   */
  async create(createServiceDto: CreateServiceDto) {
    const createdService = new this.serviceModel({
      ...createServiceDto,
      description: this.normalizeDescription(
        createServiceDto.description,
        false,
      ),
    });
    const savedService = await createdService.save();

    return {
      message: 'Service created successfully',
      data: savedService,
    };
  }

  /**
   * Fetch all services from the database
   *
   * @returns An array of service documents, each containing the details of a service along with its unique identifier (_id) and timestamps (createdAt, updatedAt). The services are sorted in descending order based on their creation date.
   * @throws InternalServerErrorException if there is an error while fetching the services from the database.
   */
  async findAll(query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    const filter = search
      ? {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { subTitle: { $regex: search, $options: 'i' } },
            { 'description.text': { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const [services, total] = await Promise.all([
      this.serviceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.serviceModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const pagination: PaginatedMetaDto = {
      page,
      limit,
      total,
      totalPages,
      count: services.length,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      ...(search ? { search } : {}),
    };

    return {
      message: 'Services fetched successfully',
      data: {
        services,
        pagination,
      },
    };
  }

  async findOne(id: MongoIdDto['id']) {
    const service = await this.serviceModel.findById(id);
    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return {
      message: 'Service fetched successfully',
      data: service,
    };
  }

  async update(id: MongoIdDto['id'], updateServiceDto: UpdateServiceDto) {
    const updatePayload = {
      ...updateServiceDto,
      ...(updateServiceDto.description
        ? {
            description: this.normalizeDescription(
              updateServiceDto.description,
            ),
          }
        : {}),
    };

    const updatedService = await this.serviceModel.findByIdAndUpdate(
      id,
      updatePayload,
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedService) {
      throw new NotFoundException('Service not found');
    }

    return {
      message: 'Service updated successfully',
      data: updatedService,
    };
  }

  async remove(id: MongoIdDto['id']) {
    const deletedService = await this.serviceModel.findByIdAndDelete(id);
    if (!deletedService) {
      throw new NotFoundException('Service not found');
    }

    return {
      message: 'Service deleted successfully',
      data: deletedService,
    };
  }

  // Helper method to normalize the description array by ensuring each item has a valid ObjectId and trimming the text
  private normalizeDescription(
    description: { id?: string; text: string }[],
    preserveIncomingId = true,
  ) {
    return description.map((item) => ({
      id:
        MongoIdDto['id'] && item.id && Types.ObjectId.isValid(item.id)
          ? new Types.ObjectId(item.id)
          : new Types.ObjectId(),
      text: item.text.trim(),
    }));
  }
}
