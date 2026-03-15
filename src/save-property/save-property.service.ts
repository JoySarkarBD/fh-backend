import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { Property, PropertyStatus } from 'src/schemas/property.schema';
import { SaveProperty } from 'src/schemas/save-property.schema';
import { User, UserDocument } from 'src/schemas/user.schema';

@Injectable()
export class SavePropertyService {
  constructor(
    @InjectModel(SaveProperty.name)
    private readonly savePropertyModel: Model<SaveProperty>,
    @InjectModel(Property.name)
    private readonly propertyModel: Model<Property>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly awsService: AwsService,
  ) {}

  async create(user: AuthUser, propertyId: string) {
    if (!Types.ObjectId.isValid(propertyId)) {
      throw new BadRequestException('Invalid property id');
    }

    const propertyObjectId = new Types.ObjectId(propertyId);
    const userObjectId = new Types.ObjectId(user.userId);

    const propertyExists = await this.propertyModel.exists({
      _id: propertyObjectId,
    });
    if (!propertyExists) {
      throw new NotFoundException('Property not found');
    }

    const existing = await this.savePropertyModel.findOne({
      userId: userObjectId,
      propertyId: propertyObjectId,
    });
    if (existing) {
      return {
        message: 'Property already saved',
        data: existing,
      };
    }

    const saved = await this.savePropertyModel.create({
      userId: userObjectId,
      propertyId: propertyObjectId,
    });

    return {
      message: 'Property saved successfully',
      data: saved,
    };
  }

  async findMine(user: AuthUser, query: Record<string, any>) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 10;
    const skip = (page - 1) * limit;
    const userObjectId = new Types.ObjectId(user.userId);

    const [savedRows, total] = await Promise.all([
      this.savePropertyModel
        .find({ userId: userObjectId })
        .populate({ path: 'propertyId' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.savePropertyModel.countDocuments({ userId: userObjectId }),
    ]);

    const data = await Promise.all(
      savedRows
        .filter((row: any) => row?.propertyId)
        .map(async (row: any) => {
          const property = row.propertyId as any;

          const images = await Promise.all(
            (property.images || []).map(async (img: any) => {
              if (!img?.key) return null;
              return {
                key: img.key,
                image: await this.awsService.generateSignedUrl(img.key),
              };
            }),
          );

          let thumbnail: { key: string; image: string } | null = null;
          if (property?.thumbnail?.key) {
            thumbnail = {
              key: property.thumbnail.key,
              image: await this.awsService.generateSignedUrl(
                property.thumbnail.key,
              ),
            };
          }

          return {
            id: row._id?.toString?.() ?? String(row._id),
            property: {
              ...property,
              propertyOwner:
                property.propertyOwner?.toString?.() ??
                String(property.propertyOwner),
              images: images.filter(Boolean),
              thumbnail,
            },
            savedAt: row.createdAt,
          };
        }),
    );

    return {
      meta: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
      data,
    };
  }

  async checkSaved(user: AuthUser, propertyId: string) {
    if (!Types.ObjectId.isValid(propertyId)) {
      throw new BadRequestException('Invalid property id');
    }

    const exists = await this.savePropertyModel.exists({
      userId: new Types.ObjectId(user.userId),
      propertyId: new Types.ObjectId(propertyId),
    });

    return {
      isSaved: Boolean(exists),
    };
  }

  async remove(user: AuthUser, propertyId: string) {
    if (!Types.ObjectId.isValid(propertyId)) {
      throw new BadRequestException('Invalid property id');
    }

    const deleted = await this.savePropertyModel.findOneAndDelete({
      userId: new Types.ObjectId(user.userId),
      propertyId: new Types.ObjectId(propertyId),
    });

    if (!deleted) {
      throw new NotFoundException('Saved property not found');
    }

    return {
      message: 'Saved property removed successfully',
      data: deleted,
    };
  }

  async getOverview(user: AuthUser) {
    const userObjectId = new Types.ObjectId(user.userId);

    // Fetch the user document so we can read the property arrays
    const userDoc = await this.userModel
      .findById(userObjectId)
      .select('propertyOwn propertyBuy propertySell')
      .lean();

    // ownCount  — every property this user has created/listed
    const ownCount = Array.isArray(userDoc?.propertyOwn)
      ? userDoc.propertyOwn.length
      : 0;

    const [sellCount, rentCount, savedCount, sellingPostCount, recentSaved] =
      await Promise.all([
        // sellCount — user's own properties currently listed FOR SALE
        this.propertyModel.countDocuments({
          propertyOwner: userObjectId,
          status: PropertyStatus.SALE,
        }),
        // rentCount — user's own properties listed FOR RENT
        this.propertyModel.countDocuments({
          propertyOwner: userObjectId,
          status: PropertyStatus.RENT,
        }),
        // savedCount — bookmarked / saved properties
        this.savePropertyModel.countDocuments({ userId: userObjectId }),
        // sellingPostCount — published selling posts
        this.propertyModel.countDocuments({
          propertyOwner: userObjectId,
          isPublished: true,
        }),
        this.savePropertyModel
          .find({ userId: userObjectId })
          .populate({ path: 'propertyId' })
          .sort({ createdAt: -1 })
          .limit(3)
          .lean(),
      ]);

    const recentSavedProperties = await Promise.all(
      recentSaved
        .filter((row: any) => row?.propertyId)
        .map(async (row: any) => {
          const property = row.propertyId as any;

          let thumbnail: { key: string; image: string } | null = null;
          if (property?.thumbnail?.key) {
            thumbnail = {
              key: property.thumbnail.key,
              image: await this.awsService.generateSignedUrl(
                property.thumbnail.key,
              ),
            };
          }

          return {
            id: row._id?.toString?.() ?? String(row._id),
            property: {
              ...property,
              propertyOwner:
                property.propertyOwner?.toString?.() ??
                String(property.propertyOwner),
              thumbnail,
            },
            savedAt: row.createdAt,
          };
        }),
    );

    return {
      stats: {
        ownCount,
        sellCount,
        rentCount,
        savedCount,
        sellingPostCount,
      },
      recentSaved: recentSavedProperties,
    };
  }
}
