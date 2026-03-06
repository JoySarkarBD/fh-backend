import { Types } from "mongoose";
import { PropertyStatus } from "src/schemas/property.schema";

export interface PropertyResponse {
  _id: Types.ObjectId;
  propertyName: string;
  status: PropertyStatus;
  overview: string;
  keyFeatures: string;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  lotSize?: number;
  price: number;
  yearBuilt: number;
  moreDetails: string;
  locationMapLink?: string;
  isPublished?: boolean;
  sellScheduleAt?: Date;
  propertyOwner: string;
  images: string[];
  thumbnail?: string;
}