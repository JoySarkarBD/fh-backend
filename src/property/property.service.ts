import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { Property } from 'src/schemas/property.schema';
import { UserRole } from 'src/schemas/user.schema';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyResponse } from './property.interface';

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
  ): Promise<PropertyResponse>{
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
      propertyOwner: user.userId,
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
      thumbnailSignedUrl = await this.awsService.generateSignedUrl(propertyObj.thumbnail.key);
    }

    return {
      ...propertyObj,
      propertyOwner: propertyObj.propertyOwner?.toString?.() ?? String(propertyObj.propertyOwner),
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
      if (Array.isArray(value)) return value.map(Number).filter((n) => !isNaN(n));
      if (typeof value === 'string')
        return value.split(',').map((v) => Number(v.trim())).filter((n) => !isNaN(n));
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
    if (squareFeetArray.length > 1) filters.squareFeet = { $in: squareFeetArray };

    const bedroomArray = toNumberArray(query?.bedrooms);
    if (bedroomArray.length === 1) filters.bedrooms = bedroomArray[0];
    if (bedroomArray.length > 1) filters.bedrooms = { $in: bedroomArray };

    const bathroomArray = toNumberArray(query?.bathrooms);
    if (bathroomArray.length === 1) filters.bathrooms = bathroomArray[0];
    if (bathroomArray.length > 1) filters.bathrooms = { $in: bathroomArray };

    if (query?.type) {
      const types = Array.isArray(query.type) ? query.type : query.type.split(',');
      filters.propertyType = { $in: types };
    }

    if (!user?.role || user.role !== UserRole.ADMIN) {
      filters.isPosted = true;
    }

    const properties = await this.propertyModel.find(filters).lean();

    const propertiesWithSignedUrls = await Promise.all(
      properties.map(async (prop) => {
        const images = await Promise.all(
          (prop.images || []).map(async (img: any) => ({
            key: img.key,
            image: await this.awsService.generateSignedUrl(img.key),
          })),
        );

        const thumbnail = {
          key: prop.thumbnail.key,
          image: await this.awsService.generateSignedUrl(prop.thumbnail.key),
        };

        return { ...prop, images, thumbnail };
      }),
    );

    return propertiesWithSignedUrls;
  }

  async findOne(id: string) {
    const property = await this.propertyModel.findOne({ _id: id });
    return property;
  }

  async update(id: string, updatePropertyDto: UpdatePropertyDto, user: AuthUser) {
    const propertyExists = await this.propertyModel.exists({ _id: id });
    if (!propertyExists) throw new NotFoundException('Property not found');

    const isOwner = await this.propertyModel.exists({
      _id: id,
      propertyOwner: user.userId,
    });
    if (!isOwner) throw new ForbiddenException('Forbidden');

    const updated = await this.propertyModel.updateOne({ _id: id }, { $set: updatePropertyDto });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const isOwner = await this.propertyModel.exists({
      _id: id,
      propertyOwner: user.userId,
    });
    if (!isOwner) throw new ForbiddenException('Forbidden');

    const deleted = await this.propertyModel.deleteOne({ _id: id });
    return deleted;
  }
}
