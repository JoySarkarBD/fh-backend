import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { Property } from 'src/schemas/property.schema';
import { UserRole } from 'src/schemas/user.schema';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyResponse } from './property.interface';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';

@Injectable()
export class PropertyService {
  constructor(
    @InjectModel(Property.name)
    private readonly propertyModel: Model<Property>,
    private readonly awsService: AwsService,
  ) {}

  async create(
    createPropertyDto: Omit<CreatePropertyDto, 'images' | 'thumbnail'> & {
      images: { key: string; image: string }[];
      thumbnail: { key: string; image: string };
    },
    user: AuthUser,
  ): Promise<PropertyResponse> {
    const normalizedImages = (createPropertyDto.images || []).map((item) => ({
      key: item.key,
      image: item.image,
    }));

    const normalizedThumbnail = {
      key: createPropertyDto.thumbnail.key,
      image: createPropertyDto.thumbnail.image,
    };

    const payload = {
      ...createPropertyDto,
      propertyOwner: new Types.ObjectId(user.userId),
      images: normalizedImages,
      thumbnail: normalizedThumbnail,
    };

    const createdPropertyDoc = new this.propertyModel(payload);
    const savedProperty = await createdPropertyDoc.save();
    const propertyObj = savedProperty.toObject();

    //! public image link generation faaaaaahhhhhhhhhhhhh
    // Generate signed URLs only (strings)
    const imagesSignedUrls: string[] = await Promise.all(
      (propertyObj.images || []).map(async (img: any) => {
        return await this.awsService.generateSignedUrl(img.key);
      }),
    );

    let thumbnailSignedUrl: string | undefined;
    if (propertyObj.thumbnail?.key) {
      thumbnailSignedUrl = await this.awsService.generateSignedUrl(
        propertyObj.thumbnail.key,
      );
    }

    return {
      ...propertyObj,
      propertyOwner:
        propertyObj.propertyOwner?.toString?.() ??
        String(propertyObj.propertyOwner),
      images: imagesSignedUrls,
      thumbnail: thumbnailSignedUrl,
    };
  }

  async findAll(user: AuthUser, query: Record<string, any>) {
    const filters: any = {};

    const toNumber = (value: any) => {
      if (value === undefined || value === null || value === '') return null;
      const num = Number(value);
      return isNaN(num) ? null : num;
    };

    const toNumberArray = (value: any) => {
      if (!value) return [];
      if (Array.isArray(value))
        return value.map(Number).filter((n) => !isNaN(n));
      if (typeof value === 'string')
        return value
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => !isNaN(n));
      return [];
    };

    const minPrice = toNumber(query?.minPrice);
    const maxPrice = toNumber(query?.maxPrice);
    if (minPrice !== null || maxPrice !== null) {
      filters.price = {};
      if (minPrice !== null) filters.price.$gte = minPrice;
      if (maxPrice !== null) filters.price.$lte = maxPrice;
    }

    const squareFeetArray = toNumberArray(query?.squareFeet);
    if (squareFeetArray.length === 1) filters.squareFeet = squareFeetArray[0];
    if (squareFeetArray.length > 1)
      filters.squareFeet = { $in: squareFeetArray };

    const bedroomArray = toNumberArray(query?.bedrooms);
    if (bedroomArray.length === 1) filters.bedrooms = bedroomArray[0];
    if (bedroomArray.length > 1) filters.bedrooms = { $in: bedroomArray };

    const bathroomArray = toNumberArray(query?.bathrooms);
    if (bathroomArray.length === 1) filters.bathrooms = bathroomArray[0];
    if (bathroomArray.length > 1) filters.bathrooms = { $in: bathroomArray };

    if (query?.type) {
      const types = Array.isArray(query.type)
        ? query.type
        : query.type.split(',');
      filters.propertyType = { $in: types };
    }

    if (!user?.role || user.role !== UserRole.ADMIN) {
      filters.isPosted = true;
    }

    const properties = await this.propertyModel.find(filters).lean();

    const propertiesWithSignedUrls = await Promise.all(
      properties.map(async (prop) => {
       const images = await Promise.all(
  (prop.images || []).map(async (img: any) => {
    if (!img?.key) return null;

    return {
      key: img.key,
      image: await this.awsService.generateSignedUrl(img.key),
    };
  }),
);
  let thumbnail: { key: string; image: string } | null = null;

if (prop?.thumbnail?.key) {
  thumbnail = {
    key: prop.thumbnail.key,
    image: await this.awsService.generateSignedUrl(prop.thumbnail.key),
  };
}

        return { ...prop, images, thumbnail };
      }),
    );

    return propertiesWithSignedUrls;
  }
async findAllOwnProperty(user: AuthUser, query: Record<string, any>) {
  const page = Number(query?.page) || 1;
  const limit = Number(query?.limit) || 10;
  const skip = (page - 1) * limit;

  const ownerId = new Types.ObjectId(user.userId);


  const filters: any = {
    propertyOwner: ownerId,
  };

  const properties = await this.propertyModel
    .find(filters)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 })
    .lean();

  const total = await this.propertyModel.countDocuments(filters);

  const propertiesWithSignedUrls = await Promise.all(
    properties.map(async (prop) => {
  const images = await Promise.all(
  (prop.images || []).map(async (img: any) => {
    if (!img?.key) return null;

    return {
      key: img.key,
      image: await this.awsService.generateSignedUrl(img.key),
    };
  }),
);
      let thumbnail;
      if (prop.thumbnail?.key) {
        thumbnail = {
          key: prop.thumbnail.key,
          image: await this.awsService.generateSignedUrl(prop.thumbnail.key),
        };
      }

      return {
        ...prop,
        images,
        thumbnail,
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
    data: propertiesWithSignedUrls,
  };
}
async findOne(id: MongoIdDto['id']) {
  const property = await this.propertyModel.findOne({ _id: id }).lean();

  if (!property) {
    throw new NotFoundException('Property not found');
  }

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
      image: await this.awsService.generateSignedUrl(property.thumbnail.key),
    };
  }

  return {
    ...property,
    images: images.filter(Boolean),
    thumbnail,
  };
}

  async update(
    id: MongoIdDto['id'],
    updatePropertyDto: UpdatePropertyDto,
    user: AuthUser,
  ) {
    const propertyExists = await this.propertyModel.exists({ _id: id });
    if (!propertyExists) throw new NotFoundException('Property not found');

    const isOwner = await this.propertyModel.exists({
      _id: id,
      propertyOwner: user.userId,
    });
    if (!isOwner) throw new ForbiddenException('Forbidden');

    const updated = await this.propertyModel.updateOne(
      { _id: id },
      { $set: updatePropertyDto },
    );
    return updated;
  }

  async remove(id: MongoIdDto['id'], user: AuthUser) {
    const isOwner = await this.propertyModel.exists({
      _id: id,
      propertyOwner: user.userId,
    });
    if (!isOwner) throw new ForbiddenException('Forbidden');

    const deleted = await this.propertyModel.deleteOne({ _id: id });
    return deleted;
  }
}
