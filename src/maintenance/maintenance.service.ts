import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import {
  Maintenance,
  MaintenanceDocument,
} from 'src/schemas/maintenance.schema';
import { PaginatedMetaDto, PaginationDto } from 'src/common/dto/pagination.dto';
import { MongoIdDto, UserIdDto } from 'src/common/dto/mongoId.dto';

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectModel(Maintenance.name)
    private readonly maintenanceModel: Model<MaintenanceDocument>,
  ) {}

  async create(
    userId: UserIdDto['userId'],
    createMaintenanceDto: CreateMaintenanceDto,
  ) {
    const createdMaintenance = new this.maintenanceModel({
      ...createMaintenanceDto,
      user: new Types.ObjectId(userId),
    });
    const savedMaintenance = await createdMaintenance.save();

    return {
      message: 'Maintenance created successfully',
      data: savedMaintenance,
    };
  }

  async findAll(userId: UserIdDto['userId'], query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    const baseFilter = { user: new Types.ObjectId(userId) };
    const filter = search
      ? {
          ...baseFilter,
          $or: [
            { amenities: { $regex: search, $options: 'i' } },
            { task: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ],
        }
      : baseFilter;

    const [maintenances, total] = await Promise.all([
      this.maintenanceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.maintenanceModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const pagination: PaginatedMetaDto = {
      page,
      limit,
      total,
      totalPages,
      count: maintenances.length,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      ...(search ? { search } : {}),
    };

    return {
      message: 'Maintenances fetched successfully',
      data: {
        maintenances,
        pagination,
      },
    };
  }

  async findOne(id: MongoIdDto['id'], userId: UserIdDto['userId']) {
    const maintenance = await this.maintenanceModel.findOne({
      _id: id,
      user: new Types.ObjectId(userId),
    });

    if (!maintenance) {
      throw new NotFoundException('Maintenance not found');
    }

    return {
      message: 'Maintenance fetched successfully',
      data: maintenance,
    };
  }

  async update(
    id: MongoIdDto['id'],
    userId: UserIdDto['userId'],
    updateMaintenanceDto: UpdateMaintenanceDto,
  ) {

    const updatedMaintenance = await this.maintenanceModel.findOneAndUpdate(
      { _id: id, user: new Types.ObjectId(userId) },
      updateMaintenanceDto,
      { new: true, runValidators: true },
    );

    if (!updatedMaintenance) {
      throw new NotFoundException('Maintenance not found');
    }

    return {
      message: 'Maintenance updated successfully',
      data: updatedMaintenance,
    };
  }

  async remove(id: MongoIdDto['id'], userId: UserIdDto['userId']) {

    const deletedMaintenance = await this.maintenanceModel.findOneAndDelete({
      _id: id,
      user: new Types.ObjectId(userId),
    });

    if (!deletedMaintenance) {
      throw new NotFoundException('Maintenance not found');
    }

    return {
      message: 'Maintenance deleted successfully',
      data: deletedMaintenance,
    };
  }
}
