import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import {
  ImageItem,
  User,
  UserDocument,
  UserRole,
} from 'src/schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
} from 'src/schemas/payment.schema';
import {
  Contact,
  ContactDocument,
  ContactStatus,
} from 'src/schemas/contact.schema';
import { UserIdDto } from 'src/common/dto/mongoId.dto';
import { PaginatedMetaDto, PaginationDto } from 'src/common/dto/pagination.dto';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { AwsService } from 'src/common/aws/aws.service';

type UpdateUserPayload = Omit<UpdateUserDto, 'profileImage'> & {
  profileImage?: string | ImageItem;
};

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly awsService: AwsService,
  ) {}

  private getImageKey(profileImage?: ImageItem | string): string | undefined {
    if (!profileImage) return profileImage;

    if (typeof profileImage === 'string') {
      return this.awsService.extractKeyFromUrl(profileImage) ?? profileImage;
    }

    if (profileImage.key) {
      return profileImage.key;
    }

    if (profileImage.image) {
      return this.awsService.extractKeyFromUrl(profileImage.image) ?? undefined;
    }

    return undefined;
  }

  private async resolveProfileImage(
    profileImage?: ImageItem | string,
  ): Promise<string | ImageItem | undefined> {
    if (!profileImage) return profileImage;

    const key = this.getImageKey(profileImage);
    if (!key) {
      return typeof profileImage === 'string'
        ? profileImage
        : profileImage.image || profileImage;
    }

    // If the key is already an external URL (e.g. Google profile picture),
    // return it directly without trying to generate an S3 signed URL
    if (key.startsWith('http://') || key.startsWith('https://')) {
      return key;
    }

    try {
      return await this.awsService.generateSignedUrl(key);
    } catch {
      return typeof profileImage === 'string'
        ? profileImage
        : profileImage.image || profileImage;
    }
  }

  private async sanitizeUserWithResolvedImage<
    T extends { password?: string; profileImage?: ImageItem | string },
  >(user: T): Promise<Omit<T, 'password'>> {
    const sanitized = this.sanitizeUser(user) as Omit<T, 'password'>;

    if ('profileImage' in sanitized) {
      const resolvedImage = await this.resolveProfileImage(
        (sanitized as { profileImage?: ImageItem | string }).profileImage,
      );
      (sanitized as { profileImage?: ImageItem | string }).profileImage =
        resolvedImage;
    }

    return sanitized;
  }

  async getAdminDashboardStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      thisMonthUsers,
      activeSubscribers,
      pendingCommunication,
      revenueAgg,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({
        createdAt: { $gte: startOfMonth, $lte: now },
      }),
      this.userModel.countDocuments({ isSubscribed: true }),
      this.contactModel.countDocuments({
        status: ContactStatus.PENDING,
      }),
      this.paymentModel.aggregate<{ totalRevenue: number }>([
        { $match: { status: PaymentStatus.COMPLETED } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
          },
        },
      ]),
    ]);

    const totalRevenue = revenueAgg[0]?.totalRevenue ?? 0;
    const conversionRate =
      totalUsers > 0
        ? Number(((activeSubscribers / totalUsers) * 100).toFixed(1))
        : 0;

    return {
      message: 'Admin dashboard stats fetched successfully',
      data: {
        totalUsers,
        thisMonthUsers,
        activeSubscribers,
        totalRevenue,
        pendingCommunication,
        conversionRate,
      },
    };
  }

  /**
   * Fetch the profile of the currently authenticated user by their ID.
   *
   * @param userId - The ID of the user whose profile is to be fetched. This ID is expected to be a valid MongoDB ObjectId string.
   * @returns An object containing a success message and the user's profile data, excluding sensitive information like the password.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided user ID is not a valid MongoDB ObjectId.
   */
  async getUserProfile(userId: UserIdDto['userId']) {
    const user = await this.getUserByIdOrThrow(userId);

    return {
      message: 'Profile fetched successfully',
      data: await this.sanitizeUserWithResolvedImage(user),
    };
  }

  /**
   * Update the profile of a specific user by their ID.
   *
   * @param userId - The ID of the user whose profile is to be updated. This ID is expected to be a valid MongoDB ObjectId string.
   * @param updateUserDto - An object containing the fields that the user wants to update in their profile, such as name, phone, etc. This data is validated against the UpdateUserDto class.
   * @returns An object containing a success message and the updated user's profile data, excluding sensitive information like the password.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided user ID is not a valid MongoDB ObjectId.
   */
  async updateMyProfile(
    userId: UserIdDto['userId'],
    updateUserDto: UpdateUserPayload,
  ) {
    const existingUser = await this.userModel.findById(userId).lean();
    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const oldProfileImageKey =
      updateUserDto.profileImage && existingUser.profileImage
        ? this.getImageKey(existingUser.profileImage)
        : null;

    const updatedUser = await this.userModel
      .findByIdAndUpdate(userId, updateUserDto, {
        new: true,
        runValidators: true,
      })
      .lean();

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    if (oldProfileImageKey) {
      await this.awsService.deleteFile(oldProfileImageKey).catch(() => {});
    }

    return {
      message: 'Profile updated successfully',
      data: await this.sanitizeUserWithResolvedImage(updatedUser),
    };
  }

  /**
   * Fetch a paginated list of all users in the system, with optional search functionality to filter users by name, email, or phone number. This endpoint is restricted to admin users only.
   *
   * @param query - An object containing pagination parameters (page, limit) and an optional search string to filter users by name or email. This data is validated against the PaginationDto class.
   * @returns An object containing a success message, an array of user profiles matching the search criteria (if provided), and pagination metadata such as total items, total pages, current page, and items per page.
   * @throws NotFoundException if no users are found matching the search criteria.
   * @throws BadRequestException if the provided pagination parameters are invalid (e.g., negative page number or limit).
   */
  async findAllUsers(query: PaginationDto): Promise<{
    message: string;
    data: {
      users: Array<
        Omit<User, 'password'> & {
          propertyOwnCount: number;
          propertyBuyCount: number;
          propertySellCount: number;
        }
      >;
      pagination: PaginatedMetaDto;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();

    const filter = search
      ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const [users, total]: [UserDocument[], number] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;
    const pagination: PaginatedMetaDto = {
      page,
      limit,
      total,
      totalPages,
      count: users.length,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      ...(search ? { search } : {}),
    };

    return {
      message: 'Users fetched successfully',
      data: {
        users: await Promise.all(
          users.map(async (user) => {
            const sanitized = await this.sanitizeUserWithResolvedImage(user);

            return {
              ...sanitized,
              propertyOwnCount: Array.isArray(user.propertyOwn)
                ? user.propertyOwn.length
                : 0,
              propertyBuyCount: Array.isArray(user.propertyBuy)
                ? user.propertyBuy.length
                : 0,
              propertySellCount: Array.isArray(user.propertySell)
                ? user.propertySell.length
                : 0,
            };
          }),
        ),
        pagination,
      },
    };
  }

  /**
   * Fetch the profile of a specific user by their ID. This endpoint is restricted to admin users only.
   *
   * @param id - The ID of the user to be retrieved, extracted from the URL parameter. This ID is validated to ensure it is a valid MongoDB ObjectId using the MongoIdDto class.
   * @returns An object containing a success message and the user's profile data, excluding sensitive information like the password.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided ID is not a valid MongoDB ObjectId.
   */
  async findUserById(id: MongoIdDto['id']) {
    const user = await this.getUserByIdOrThrow(id);

    return {
      message: 'User fetched successfully',
      data: await this.sanitizeUserWithResolvedImage(user),
    };
  }

  /**
   * Delete a specific user by their ID. This endpoint is restricted to admin users only and cannot be used to delete the admin's own account.
   *
   * @param id - The ID of the user to be deleted, extracted from the URL parameter. This ID is validated to ensure it is a valid MongoDB ObjectId using the MongoIdDto class.
   * @returns An object containing a success message confirming the deletion of the user.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided ID is not a valid MongoDB ObjectId.
   * @throws ForbiddenException if an admin attempts to delete their own account.
   */
  async removeUserByAdmin(id: MongoIdDto['id']) {
    const deletedUser = await this.userModel.findByIdAndDelete(id).lean();
    if (!deletedUser) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'User deleted successfully',
      data: this.sanitizeUser(deletedUser),
    };
  }

  /**
   * Toggle the suspension status of a specific user by their ID. This endpoint is restricted to admin users only and cannot be used to suspend or unsuspend the admin's own account.
   *
   * @param id - The ID of the user whose suspension status is to be toggled, extracted from the URL parameter. This ID is validated to ensure it is a valid MongoDB ObjectId using the MongoIdDto class.
   * @returns An object containing a success message confirming the suspension status toggle of the user.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided ID is not a valid MongoDB ObjectId.
   */
  async suspendToggleByAdmin(id: MongoIdDto['id']) {
    const user = await this.userModel.findById(id).lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(
        id,
        { isSuspended: !user.isSuspended },
        { new: true, runValidators: true },
      )
      .lean();

    if (!updatedUser) {
      throw new NotFoundException('User not found after update');
    }

    return {
      message: `User ${updatedUser.isSuspended ? 'suspended' : 'unsuspended'} successfully`,
      data: this.sanitizeUser(updatedUser),
    };
  }

  // Helper method to fetch user by ID and throw NotFoundException if user does not exist

  private async getUserByIdOrThrow(id: MongoIdDto['id']) {
    const user = await this.userModel.findById(id).lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private sanitizeUser<T extends { password?: string }>(
    user: T,
  ): Omit<T, 'password'> {
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    return sanitizedUser;
  }
}
