import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Property,
  PropertyModerationStatus,
  PropertyStatus,
} from 'src/schemas/property.schema';
import { User, UserDocument } from 'src/schemas/user.schema';

type SeedLocation = {
  area: string;
  city: string;
  country: string;
};

@Injectable()
export class SeedService {
  constructor(
    @InjectModel(Property.name)
    private readonly propertyModel: Model<Property>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private readonly locations: SeedLocation[] = [
    { area: 'Gulshan-1', city: 'Dhaka', country: 'Bangladesh' },
    { area: 'Banani', city: 'Dhaka', country: 'Bangladesh' },
    { area: 'Dhanmondi', city: 'Dhaka', country: 'Bangladesh' },
    { area: 'Badda', city: 'Dhaka', country: 'Bangladesh' },
    { area: 'Uttara', city: 'Dhaka', country: 'Bangladesh' },
    { area: 'Mirpur', city: 'Dhaka', country: 'Bangladesh' },
    { area: 'Chawkbazar', city: 'Chattogram', country: 'Bangladesh' },
    { area: 'Khulshi', city: 'Chattogram', country: 'Bangladesh' },
    { area: 'Kotwali', city: 'Sylhet', country: 'Bangladesh' },
    { area: 'Boalia', city: 'Rajshahi', country: 'Bangladesh' },
    { area: 'Sonadanga', city: 'Khulna', country: 'Bangladesh' },
    { area: 'Sadar', city: 'Barishal', country: 'Bangladesh' },
  ];

  private readonly propertyTypes = [
    'Apartment',
    'Duplex',
    'Luxury Property',
    'Land',
    'Condo',
    'Villa',
  ];

  private readonly statusPool = [
    PropertyStatus.SALE,
    PropertyStatus.RENT,
    PropertyStatus.SOLD,
  ];

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomFrom<T>(list: T[]): T {
    return list[this.randomInt(0, list.length - 1)];
  }

  private createDummyImage(seed: string, width = 1200, height = 800): {
    key: string;
    image: string;
  } {
    const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
    return { key: url, image: url };
  }

  private async getOrCreateOwner(): Promise<Types.ObjectId> {
    const users = await this.userModel.find().select('_id').lean();

    if (users.length > 0) {
      return this.randomFrom(users)._id;
    }

    const seedIdentity = Date.now();
    const createdUser = await this.userModel.create({
      name: 'Seed User',
      email: `seed-user-${seedIdentity}@example.com`,
      isSubscribed: true,
    });

    return createdUser._id as Types.ObjectId;
  }

  async seedProperties(total: number) {
    const ownerId = await this.getOrCreateOwner();

    const docs = Array.from({ length: total }).map((_, index) => {
      const id = Date.now() + index;
      const location = this.randomFrom(this.locations);
      const type = this.randomFrom(this.propertyTypes);
      const status = this.randomFrom(this.statusPool);

      const bedrooms = this.randomInt(1, 6);
      const bathrooms = this.randomInt(1, 5);
      const squareFeet = this.randomInt(700, 5000);
      const lotSize = this.randomInt(1200, 9000);
      const price = this.randomInt(80000, 2500000);
      const yearBuilt = this.randomInt(1990, 2025);

      const thumbnail = this.createDummyImage(`seed-thumb-${id}`);
      const images = [
        this.createDummyImage(`seed-img-${id}-1`),
        this.createDummyImage(`seed-img-${id}-2`),
        this.createDummyImage(`seed-img-${id}-3`),
      ];

      const address = `${location.area}, ${location.city}, ${location.country}`;
      const mapLink = `https://maps.google.com/?q=${encodeURIComponent(address)}`;

      return {
        propertyName: `${type} ${index + 1} in ${location.area}`,
        status,
        moderationStatus: PropertyModerationStatus.ACTIVE,
        overview: `Beautiful ${type.toLowerCase()} located in ${location.area}. Great connectivity and neighborhood amenities.`,
        keyFeatures: `Parking, Balcony, Security, Nearby Market, Ready to Move`,
        bedrooms,
        bathrooms,
        squareFeet,
        lotSize,
        price,
        yearBuilt,
        moreDetails:
          'Interior: Modern finishing with natural lighting.\n\nExterior: Landscaped surroundings and secure entrance.',
        locationMapLink: mapLink,
        address,
        isPublished: true,
        propertyType: type,
        sellScheduleAt: new Date(Date.now() + this.randomInt(1, 90) * 86400000),
        thumbnail,
        images,
        propertyOwner: ownerId,
      };
    });

    const inserted = await this.propertyModel.insertMany(docs, { ordered: false });

    return {
      success: true,
      message: `${inserted.length} seed properties created successfully`,
      count: inserted.length,
      sampleIds: inserted.slice(0, 5).map((item) => item._id),
    };
  }
}
