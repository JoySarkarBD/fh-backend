import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { MailService } from 'src/mail/mail.service';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
} from 'src/schemas/payment.schema';
import {
  Property,
  PropertyModerationStatus,
  PropertyStatus,
} from 'src/schemas/property.schema';
import { SaveProperty } from 'src/schemas/save-property.schema';
import { User, UserDocument, UserRole } from 'src/schemas/user.schema';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyResponse } from './property.interface';

@Injectable()
export class PropertyService {
  constructor(
    @InjectModel(Property.name)
    private readonly propertyModel: Model<Property>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(SaveProperty.name)
    private readonly savedPropertyModel: Model<SaveProperty>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly awsService: AwsService,
    private readonly mailService: MailService,
  ) {}

  private async deliverNotificationEmail(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    try {
      await this.mailService.enqueueMail(options);
      console.log(`[Notification] ✅ Successfully enqueued for: ${options.to}`);
    } catch (error: any) {
      const enqueueError = error?.message || String(error);
      console.log(
        `[Notification] ⚠️ Failed to enqueue for: ${options.to}. Trying direct SMTP fallback...`,
        enqueueError,
      );

      await this.mailService.sendMailDirect(options);
      console.log(
        `[Notification] ✅ Direct SMTP fallback sent for: ${options.to}`,
      );
    }
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async notifyPropertyOwnerListingLive(property: any): Promise<void> {
    try {
      const ownerId =
        property?.propertyOwner?.toString?.() ??
        String(property?.propertyOwner);
      if (!ownerId || !Types.ObjectId.isValid(ownerId)) {
        console.log('[ListingLive] Skipping - invalid property owner id');
        return;
      }

      const owner = await this.userModel
        .findById(ownerId)
        .select('email name isSuspended')
        .lean<{ email?: string; name?: string; isSuspended?: boolean }>();

      if (!owner?.email) {
        console.log('[ListingLive] Skipping - owner email not found');
        return;
      }

      if (owner.isSuspended) {
        console.log('[ListingLive] Skipping - owner is suspended');
        return;
      }

      const subject = `Your listing is now live: ${this.escapeHtml(property.propertyName)}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #2e7d32; margin-top: 0;">Listing Live Notification</h2>
          <p>Hello ${this.escapeHtml(owner.name || 'there')},</p>
          <p>Your property listing is now live on the platform.</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="padding: 10px; background: #f8f8f8; font-weight: bold; width: 30%;">Property</td>
              <td style="padding: 10px; background: #f8f8f8;">${this.escapeHtml(property.propertyName)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; font-weight: bold;">Type</td>
              <td style="padding: 10px;">${this.escapeHtml(property.propertyType)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; background: #f8f8f8; font-weight: bold;">Address</td>
              <td style="padding: 10px; background: #f8f8f8;">${this.escapeHtml(property.address)}</td>
            </tr>
          </table>
        </div>
      `;
      const text =
        `Listing Live Notification\n\n` +
        `Your property is now live on the platform.\n` +
        `Property: ${property.propertyName}\n` +
        `Type: ${property.propertyType}\n` +
        `Address: ${property.address}`;

      await this.deliverNotificationEmail({
        to: owner.email,
        subject,
        html,
        text,
      });
    } catch (error) {
      console.error('[ListingLive] Failed to notify property owner:', error);
    }
  }

  private async notifySavedPropertyActivity(options: {
    property: any;
    activity: 'sold' | 'rented' | 'desisted';
    excludeUserId?: string;
  }): Promise<void> {
    try {
      const { property, activity, excludeUserId } = options;
      const propertyId = property?._id?.toString?.() ?? String(property?._id);

      if (!propertyId || !Types.ObjectId.isValid(propertyId)) {
        console.log('[FavoritesActivity] Skipping - invalid property id');
        return;
      }

      const savedRecords = await this.savedPropertyModel
        .find({ propertyId: new Types.ObjectId(propertyId) })
        .select('userId')
        .lean();

      const userIds = Array.from(
        new Set(
          savedRecords
            .map((record: any) => record.userId?.toString?.())
            .filter((userId: string | undefined): userId is string => {
              return !!userId && userId !== excludeUserId;
            }),
        ),
      );

      console.log(`[FavoritesActivity] Matched saved users: ${userIds.length}`);

      if (userIds.length === 0) {
        console.log('[FavoritesActivity] No saved-property users to notify');
        return;
      }

      const users = await this.userModel
        .find({
          _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
          isSuspended: { $ne: true },
        })
        .select('email name')
        .lean<{ _id: Types.ObjectId; email?: string; name?: string }[]>();

      const activityLabel =
        activity === 'sold'
          ? 'sold'
          : activity === 'rented'
            ? 'rented'
            : 'delisted';

      for (const user of users) {
        if (!user.email) continue;

        const subject = `Favorites Activity: ${this.escapeHtml(property.propertyName)} was ${activityLabel}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #c26828; margin-top: 0;">Favorites Activity</h2>
            <p>Hello ${this.escapeHtml(user.name || 'there')},</p>
            <p>A property in your saved list has been <strong>${this.escapeHtml(activityLabel)}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <tr>
                <td style="padding: 10px; background: #f8f8f8; font-weight: bold; width: 30%;">Property</td>
                <td style="padding: 10px; background: #f8f8f8;">${this.escapeHtml(property.propertyName)}</td>
              </tr>
              <tr>
                <td style="padding: 10px; font-weight: bold;">Type</td>
                <td style="padding: 10px;">${this.escapeHtml(property.propertyType)}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f8f8f8; font-weight: bold;">Address</td>
                <td style="padding: 10px; background: #f8f8f8;">${this.escapeHtml(property.address)}</td>
              </tr>
            </table>
          </div>
        `;
        const text =
          `Favorites Activity\n\n` +
          `A property in your saved list was ${activityLabel}.\n` +
          `Property: ${property.propertyName}\n` +
          `Type: ${property.propertyType}\n` +
          `Address: ${property.address}`;

        await this.deliverNotificationEmail({
          to: user.email,
          subject,
          html,
          text,
        });
      }
    } catch (error) {
      console.error(
        '[FavoritesActivity] Failed to notify saved-property users:',
        error,
      );
    }
  }

  private async notifyAdminsMarketUpdates(options: {
    eventLabel: string;
    property?: any;
  }): Promise<void> {
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        adminUsers,
        weeklyListings,
        monthlyListings,
        weeklyRevenueAgg,
        monthlyRevenueAgg,
      ] = await Promise.all([
        this.userModel
          .find({ role: UserRole.ADMIN, isSuspended: { $ne: true } })
          .select('email name')
          .lean<{ email?: string; name?: string }[]>(),
        this.propertyModel.countDocuments({
          isPublished: true,
          createdAt: { $gte: weekAgo },
        }),
        this.propertyModel.countDocuments({
          isPublished: true,
          createdAt: { $gte: monthAgo },
        }),
        this.paymentModel.aggregate<{ total: number }>([
          {
            $match: {
              status: PaymentStatus.COMPLETED,
              paidAt: { $gte: weekAgo },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        this.paymentModel.aggregate<{ total: number }>([
          {
            $match: {
              status: PaymentStatus.COMPLETED,
              paidAt: { $gte: monthAgo },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);

      const weeklyRevenue = weeklyRevenueAgg[0]?.total ?? 0;
      const monthlyRevenue = monthlyRevenueAgg[0]?.total ?? 0;

      const propertyName = options.property?.propertyName
        ? this.escapeHtml(options.property.propertyName)
        : 'N/A';
      const propertyType = options.property?.propertyType
        ? this.escapeHtml(options.property.propertyType)
        : 'N/A';

      for (const admin of adminUsers) {
        if (!admin.email) continue;

        const subject = `Market Updates: ${this.escapeHtml(options.eventLabel)}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="margin-top: 0; color: #1f4e79;">Market Updates</h2>
            <p>Hello ${this.escapeHtml(admin.name || 'Admin')},</p>
            <p>An event occurred that may impact market trends: <strong>${this.escapeHtml(options.eventLabel)}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 10px; background: #f8f8f8; font-weight: bold; width: 45%;">Published listings (last 7 days)</td>
                <td style="padding: 10px; background: #f8f8f8;">${weeklyListings}</td>
              </tr>
              <tr>
                <td style="padding: 10px; font-weight: bold;">Published listings (last 30 days)</td>
                <td style="padding: 10px;">${monthlyListings}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f8f8f8; font-weight: bold;">Revenue trend (last 7 days)</td>
                <td style="padding: 10px; background: #f8f8f8;">$${weeklyRevenue}</td>
              </tr>
              <tr>
                <td style="padding: 10px; font-weight: bold;">Revenue trend (last 30 days)</td>
                <td style="padding: 10px;">$${monthlyRevenue}</td>
              </tr>
              <tr>
                <td style="padding: 10px; background: #f8f8f8; font-weight: bold;">Latest listing</td>
                <td style="padding: 10px; background: #f8f8f8;">${propertyName} (${propertyType})</td>
              </tr>
            </table>
          </div>
        `;
        const text =
          `Market Updates\n\n` +
          `Event: ${options.eventLabel}\n` +
          `Published listings (7d): ${weeklyListings}\n` +
          `Published listings (30d): ${monthlyListings}\n` +
          `Revenue (7d): $${weeklyRevenue}\n` +
          `Revenue (30d): $${monthlyRevenue}\n` +
          `Latest listing: ${propertyName} (${propertyType})`;

        await this.deliverNotificationEmail({
          to: admin.email,
          subject,
          html,
          text,
        });
      }
    } catch (error) {
      console.error('[MarketUpdates] Failed to notify admins:', error);
    }
  }

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
      status: createPropertyDto.propertyStatus as PropertyStatus,
      moderationStatus:
        createPropertyDto.moderationStatus ?? PropertyModerationStatus.PENDING,
      propertyType: createPropertyDto.propertyType,
      propertyOwner: new Types.ObjectId(user.userId),
      images: normalizedImages,
      thumbnail: normalizedThumbnail,
    };

    const createdPropertyDoc = new this.propertyModel(payload);
    let savedProperty: any;
    try {
      savedProperty = await createdPropertyDoc.save();
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Property validation failed',
      );
    }
    const propertyObj = savedProperty.toObject();

    // Ensure user document has propertyOwn, propertyBuy, propertySell fields
    const userDoc = await this.userModel.findById(user.userId);
    const updateFields: any = {};
    if (userDoc) {
      if (!userDoc.propertyOwn) updateFields.propertyOwn = [];
      if (!userDoc.propertyBuy) updateFields.propertyBuy = [];
      if (!userDoc.propertySell) updateFields.propertySell = [];
      if (Object.keys(updateFields).length > 0) {
        await this.userModel.findByIdAndUpdate(user.userId, {
          $set: updateFields,
        });
      }
    }

    // Add property to user's propertyOwn array
    await this.userModel.findByIdAndUpdate(
      user.userId,
      { $addToSet: { propertyOwn: savedProperty._id } },
      { new: true },
    );

    // Recompute and persist property counts on the user document
    try {
      const refreshedUser = await this.userModel.findById(user.userId).lean();
      const countsUpdate: any = {};
      if (refreshedUser) {
        countsUpdate.propertyOwnCount = Array.isArray(refreshedUser.propertyOwn)
          ? refreshedUser.propertyOwn.length
          : 0;
        countsUpdate.propertyBuyCount = Array.isArray(refreshedUser.propertyBuy)
          ? refreshedUser.propertyBuy.length
          : 0;
        countsUpdate.propertySellCount = Array.isArray(
          refreshedUser.propertySell,
        )
          ? refreshedUser.propertySell.length
          : 0;

        await this.userModel
          .findByIdAndUpdate(user.userId, { $set: countsUpdate })
          .catch((e) =>
            console.error('[PropertyCreate] Failed to persist user counts:', e),
          );
      }
    } catch (err) {
      console.error('[PropertyCreate] Error while updating user counts:', err);
    }

    // Generate signed URLs
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

    // ✅ Fire & forget — does NOT block the API response
    this.triggerPropertyTypeNotification(savedProperty, user.userId).catch(
      (err) => console.error('[Notification] Background pipeline failed:', err),
    );

    if (savedProperty.isPublished === true) {
      this.notifyPropertyOwnerListingLive(savedProperty).catch((err) =>
        console.error('[ListingLive] Background pipeline failed:', err),
      );

      this.notifyAdminsMarketUpdates({
        eventLabel: 'New listing published',
        property: savedProperty,
      }).catch((err) =>
        console.error('[MarketUpdates] Background pipeline failed:', err),
      );
    }

    return {
      ...propertyObj,
      moreDetails: propertyObj.moreDetails ?? '',
      propertyOwner:
        propertyObj.propertyOwner?.toString?.() ??
        String(propertyObj.propertyOwner),
      images: imagesSignedUrls,
      thumbnail: thumbnailSignedUrl,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Background notification — runs after API response is returned
  // ─────────────────────────────────────────────────────────────
  private async triggerPropertyTypeNotification(
    savedProperty: any,
    creatorUserId: string,
  ): Promise<void> {
    try {
      const propertyType = savedProperty.propertyType;
      const propertyId = savedProperty._id;

      console.log('\n========== 🔔 NOTIFICATION TRIGGERED ==========');
      console.log(`[Notification] Time: ${new Date().toISOString()}`);
      console.log(`[Notification] Property ID: ${propertyId}`);
      console.log(
        `[Notification] Property Name: ${savedProperty.propertyName}`,
      );
      console.log(`[Notification] Property Type: ${propertyType}`);
      console.log(`[Notification] Creator User ID: ${creatorUserId}`);
      console.log(`[Notification] Is Published: ${savedProperty.isPublished}`);

      // Step 1: First, let's check how many saved properties exist in total
      const totalSavedProperties =
        await this.savedPropertyModel.countDocuments();
      console.log(
        `[Notification] Total saved properties in DB: ${totalSavedProperties}`,
      );

      // Step 2: Find all saved properties without populate first to see what we have
      const allSavedProperties = await this.savedPropertyModel.find().lean();
      console.log(
        `[Notification] All saved properties (without populate):`,
        allSavedProperties.map((sp) => ({
          id: sp._id,
          userId: sp.userId,
          propertyId: sp.propertyId,
        })),
      );

      // Step 3: Now find with populate to match property type
      console.log(
        `[Notification] Finding saved properties with matching type: ${propertyType}`,
      );

      const matchedSavedProperties = await this.savedPropertyModel
        .find()
        .populate({
          path: 'propertyId',
          match: { propertyType }, // only populate if type matches
          select: 'propertyType propertyName address',
        })
        .lean();

      console.log(
        `[Notification] After populate - found ${matchedSavedProperties.length} records`,
      );

      // Log each matched saved property for debugging
      matchedSavedProperties.forEach((sp: any, index: number) => {
        console.log(`[Notification] Matched[${index}]:`, {
          savedPropertyId: sp._id,
          userId: sp.userId,
          populatedPropertyId: sp.propertyId?._id,
          populatedPropertyType: sp.propertyId?.propertyType,
          populatedPropertyName: sp.propertyId?.propertyName,
        });
      });

      // Step 4: Filter out non-matching (null populated) and exclude the creator
      const userIds = Array.from(
        new Set(
          matchedSavedProperties.flatMap((sp: any) => {
            if (sp.propertyId === null || !sp.userId) {
              if (sp.propertyId === null) {
                console.log(
                  `[Notification] ❌ Skipping - propertyId is null (type mismatch)`,
                );
              }
              if (!sp.userId) {
                console.log(`[Notification] ❌ Skipping - no userId`);
              }
              return [];
            }

            const userId = sp.userId.toString();
            const isCreator = userId === creatorUserId;

            if (isCreator) {
              console.log(`[Notification] 👤 Skipping creator user: ${userId}`);
            } else {
              console.log(
                `[Notification] ✅ Including user: ${userId} (saved property type: ${sp.propertyId.propertyType})`,
              );
            }

            return !isCreator ? [userId] : [];
          }),
        ),
      ) as string[];

      console.log(
        `[Notification] After filtering - unique users found: ${userIds.length}`,
      );
      console.log(`[Notification] User IDs:`, userIds);

      if (userIds.length === 0) {
        console.log(
          `[Notification] ⚠️ No users found to notify for property type: ${propertyType}`,
        );

        // Check if there are any saved properties of this type at all
        const savedPropsWithThisType = await this.savedPropertyModel
          .find()
          .populate({
            path: 'propertyId',
            match: { propertyType },
            select: 'propertyType',
          })
          .countDocuments();

        console.log(
          `[Notification] Total saved properties with type ${propertyType}: ${savedPropsWithThisType}`,
        );
        return;
      }

      // Step 5: Fetch emails of matched users
      console.log(
        `[Notification] Fetching email addresses for ${userIds.length} users...`,
      );

      const users = await this.userModel
        .find({
          _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
          isSuspended: { $ne: true },
        })
        .select('email name isSuspended')
        .lean();

      console.log(`[Notification] Found ${users.length} eligible users`);

      users.forEach((user: any, index: number) => {
        console.log(
          `[Notification] User[${index}]: ID=${user._id}, Email=${user.email}, Name=${user.name || 'N/A'}`,
        );
      });

      const emails = users
        .map((u: any) => u.email)
        .filter((email): email is string => !!email);

      console.log(`[Notification] Valid emails found: ${emails.length}`);
      console.log(`[Notification] Email list:`, emails);

      if (emails.length === 0) {
        console.log(
          '[Notification] ❌ No valid emails found - all users missing email addresses',
        );
        return;
      }

      // Step 6: Build email content
      const subject = `New ${this.escapeHtml(propertyType)} Property Added: ${this.escapeHtml(savedProperty.propertyName)}`;

      const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #2e7d32; margin: 0;">🏠 New Property Alert</h2>
        </div>
        
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 16px;">A new <strong style="color: #2e7d32;">${this.escapeHtml(propertyType)}</strong> property has been listed that matches your interests!</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 10px; background-color: #f9f9f9; font-weight: bold; width: 30%;">Property Name:</td>
            <td style="padding: 10px; background-color: #f9f9f9;">${this.escapeHtml(savedProperty.propertyName)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; font-weight: bold;">Address:</td>
            <td style="padding: 10px;">${this.escapeHtml(savedProperty.address)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; background-color: #f9f9f9; font-weight: bold;">Price:</td>
            <td style="padding: 10px; background-color: #f9f9f9;">$${this.escapeHtml(String(savedProperty.price))}</td>
          </tr>
          <tr>
            <td style="padding: 10px; font-weight: bold;">Type:</td>
            <td style="padding: 10px;">${this.escapeHtml(propertyType)}</td>
          </tr>
        </table>

        <div style="text-align: center; margin-top: 25px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
          <p style="color: #666; font-size: 14px; margin: 0;">
            You received this email because you saved a property with type <strong>${this.escapeHtml(propertyType)}</strong>.
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 10px;">
            © ${new Date().getFullYear()} Your Property Platform. All rights reserved.
          </p>
        </div>
      </div>
    `;

      const text =
        `New ${propertyType} Property Added!\n\n` +
        `Property: ${savedProperty.propertyName}\n` +
        `Address: ${savedProperty.address}\n` +
        `Price: $${savedProperty.price}\n\n` +
        `You received this because you saved a property with type: ${propertyType}`;

      // Step 7: Cap recipients and send emails
      const MAX_RECIPIENTS = 500;
      const limitedEmails = emails.slice(0, MAX_RECIPIENTS);

      console.log(
        `[Notification] 📧 Attempting to send emails to ${limitedEmails.length} recipients...`,
      );

      // Define result type
      type EmailResult = {
        status: 'fulfilled' | 'rejected';
        email: string;
        reason?: string;
      };

      const results: EmailResult[] = [];

      for (const email of limitedEmails) {
        try {
          console.log(`[Notification] Enqueuing email for: ${email}`);

          await this.deliverNotificationEmail({
            to: email,
            subject,
            html,
            text,
          });
          results.push({ status: 'fulfilled', email });
        } catch (error: any) {
          results.push({
            status: 'rejected',
            email,
            reason: error?.message || String(error),
          });
        }

        // Small delay to avoid overwhelming the queue
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      console.log('\n========== 📊 NOTIFICATION SUMMARY ==========');
      console.log(`Property Type: ${propertyType}`);
      console.log(`Property Name: ${savedProperty.propertyName}`);
      console.log(`Total unique users found: ${userIds.length}`);
      console.log(`Valid emails found: ${emails.length}`);
      console.log(`Emails attempted: ${limitedEmails.length}`);
      console.log(`✅ Successfully enqueued: ${succeeded}`);
      console.log(`❌ Failed to enqueue: ${failed}`);

      if (failed > 0) {
        console.log(
          'Failed emails details:',
          results.filter((r) => r.status === 'rejected'),
        );
      }

      console.log('========== 🔔 NOTIFICATION COMPLETE ==========\n');
    } catch (err: any) {
      console.error('\n========== ❌ NOTIFICATION ERROR ==========');
      console.error(
        '[Notification] Error in triggerPropertyTypeNotification:',
        err,
      );
      console.error('Error stack:', err?.stack);
      console.error('========== ==================== ==========\n');
    }
  }

  async findAll(user: AuthUser, query: Record<string, any>) {
    const filters: any = {};
    // Text search by propertyName or address
    if (
      query?.search &&
      typeof query.search === 'string' &&
      query.search.trim() !== ''
    ) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      filters.$or = [
        { propertyName: { $regex: searchRegex } },
        { address: { $regex: searchRegex } },
      ];
    }

    // sellScheduleAt filter
    filters.$or = [
      { sellScheduleAt: { $exists: false } },
      { sellScheduleAt: null },
      { sellScheduleAt: { $lte: new Date() } }, // date + time check
    ];
    // Pagination
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 10;
    const skip = (page - 1) * limit;

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
    console.log(maxPrice);

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
      filters.isPublished = true;
    }

    const [properties, total] = await Promise.all([
      this.propertyModel.find(filters).skip(skip).limit(limit).lean(),
      this.propertyModel.countDocuments(filters),
    ]);

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

    const ownerId =
      property.propertyOwner?.toString?.() ?? String(property.propertyOwner);
    let propertyOwnerEmail: string | null = null;

    if (ownerId && Types.ObjectId.isValid(ownerId)) {
      const owner = await this.userModel
        .findById(ownerId)
        .select('email')
        .lean<{ email?: string }>();
      propertyOwnerEmail = owner?.email ?? null;
    }

    return {
      ...property,
      propertyOwner: ownerId,
      propertyOwnerEmail,
      images: images.filter(Boolean),
      thumbnail,
    };
  }

  async update(
    id: MongoIdDto['id'],
    updatePropertyDto: UpdatePropertyDto & {
      images?: { key: string; image: string }[];
      thumbnail?: { key: string; image: string };
    },
    user: AuthUser,
  ) {
    console.log('\n========== 🔄 PROPERTY UPDATE STARTED ==========');
    console.log(`[Update] Property ID: ${id}`);
    console.log(`[Update] User ID: ${user.userId}`);
    console.log(
      `[Update] Update DTO:`,
      JSON.stringify(updatePropertyDto, null, 2),
    );

    const existingProperty = await this.propertyModel.findById(id);
    if (!existingProperty) throw new NotFoundException('Property not found');

    if (String(existingProperty.propertyOwner) !== user.userId) {
      throw new ForbiddenException('Forbidden');
    }

    console.log(
      `[Update] Existing property - isPublished: ${existingProperty.isPublished}`,
    );
    console.log(
      `[Update] Existing property - propertyType: ${existingProperty.propertyType}`,
    );

    const payload: Record<string, any> = { ...updatePropertyDto };

    // FormData values can arrive as strings; normalize booleans used by publish flow.
    if (typeof payload.isPublished === 'string') {
      const normalized = payload.isPublished.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'false') {
        payload.isPublished = normalized === 'true';
      }
    }

    if (payload.propertyStatus) {
      payload.status = payload.propertyStatus as PropertyStatus;
      delete payload.propertyStatus;
    }

    // Handle sell schedule date
    const rawPostingDate =
      typeof payload.sellPostingDate === 'string'
        ? payload.sellPostingDate.trim()
        : '';
    const rawPostingTime =
      typeof payload.sellPostingTime === 'string'
        ? payload.sellPostingTime.trim()
        : '';

    if (rawPostingDate || rawPostingTime) {
      const existingSchedule = existingProperty.sellScheduleAt
        ? new Date(existingProperty.sellScheduleAt)
        : new Date();
      const baseDate = Number.isNaN(existingSchedule.getTime())
        ? new Date()
        : existingSchedule;

      let year = baseDate.getFullYear();
      let month = baseDate.getMonth();
      let day = baseDate.getDate();
      let hours = baseDate.getHours();
      let minutes = baseDate.getMinutes();

      if (rawPostingDate) {
        const [y, m, d] = rawPostingDate.split('-').map((part) => Number(part));
        const isDateValid =
          Number.isInteger(y) &&
          Number.isInteger(m) &&
          Number.isInteger(d) &&
          m >= 1 &&
          m <= 12 &&
          d >= 1 &&
          d <= 31;
        if (isDateValid) {
          year = y;
          month = m - 1;
          day = d;
        }
      }

      if (rawPostingTime) {
        const [h, min] = rawPostingTime.split(':').map((part) => Number(part));
        const isTimeValid =
          Number.isInteger(h) &&
          Number.isInteger(min) &&
          h >= 0 &&
          h <= 23 &&
          min >= 0 &&
          min <= 59;
        if (isTimeValid) {
          hours = h;
          minutes = min;
        }
      }

      const scheduleDate = new Date(year, month, day, hours, minutes, 0, 0);
      if (!Number.isNaN(scheduleDate.getTime())) {
        payload.sellScheduleAt = scheduleDate;
      }
    }

    delete payload.sellPostingDate;
    delete payload.sellPostingTime;

    console.log(
      `[Update] Payload before update:`,
      JSON.stringify(payload, null, 2),
    );

    const updated = await this.propertyModel
      .findByIdAndUpdate(
        id,
        { $set: payload },
        { new: true, runValidators: true },
      )
      .lean();

    console.log(`[Update] Updated property:`, {
      id: updated?._id,
      isPublished: updated?.isPublished,
      propertyType: updated?.propertyType,
      propertyName: updated?.propertyName,
    });

    // IMPORTANT: Check if property is NOW published
    // We need to check both conditions:
    // 1. If isPublished is explicitly set to true in the update
    // 2. OR if the property already had isPublished = true (but this shouldn't trigger notification again)

    const isExplicitlyPublishedNow =
      updatePropertyDto.isPublished === true || payload.isPublished === true;

    const previousStatus = String(existingProperty.status || '').toLowerCase();
    const nextStatus = String(
      updated?.status || payload.status || '',
    ).toLowerCase();
    const switchedToSale =
      previousStatus !== PropertyStatus.SALE &&
      nextStatus === PropertyStatus.SALE;

    const wasPreviouslyPublished = existingProperty.isPublished === true;
    const isPublishedAfterUpdate = updated?.isPublished === true;

    const explicitlyPostedForSale =
      payload.status === PropertyStatus.SALE ||
      payload.propertyStatus === PropertyStatus.SALE ||
      payload.sellScheduleAt !== undefined;

    const shouldNotify =
      // First publish transition
      (!wasPreviouslyPublished &&
        (isExplicitlyPublishedNow || isPublishedAfterUpdate)) ||
      // "Post for sale" style transition while already published
      (wasPreviouslyPublished && switchedToSale && isPublishedAfterUpdate) ||
      // Explicit sale-post update while published
      (isPublishedAfterUpdate && explicitlyPostedForSale);

    const becameLive = !wasPreviouslyPublished && isPublishedAfterUpdate;
    const becameSold =
      previousStatus !== PropertyStatus.SOLD &&
      nextStatus === PropertyStatus.SOLD;
    const becameRented =
      previousStatus !== PropertyStatus.RENT &&
      nextStatus === PropertyStatus.RENT;
    const becameDelisted =
      existingProperty.isPublished === true && updated?.isPublished === false;

    if (shouldNotify && updated) {
      console.log(
        `[Update] ✅ Property is now published! Triggering notifications...`,
      );
      console.log(
        `[Update] Property type for notification: ${updated.propertyType}`,
      );

      // Fire & forget - with better error handling
      this.triggerPropertyTypeNotification(updated, user.userId)
        .then(() => {
          console.log(
            `[Update] ✅ Notification process completed successfully`,
          );
        })
        .catch((err) => {
          console.error(
            '[Update] ❌ Notification background pipeline failed:',
            err,
          );
        });
    } else {
      console.log(`[Update] ❌ Not triggering notifications because:`);
      if (wasPreviouslyPublished)
        console.log(`[Update] - Property was already published`);
      if (!isExplicitlyPublishedNow && updated?.isPublished !== true)
        console.log(`[Update] - Property is not published`);
      if (!switchedToSale)
        console.log(`[Update] - Property status did not switch to sale`);
    }

    if (updated && becameLive) {
      this.notifyPropertyOwnerListingLive(updated).catch((err) => {
        console.error('[Update] ❌ Listing live notification failed:', err);
      });

      this.notifyAdminsMarketUpdates({
        eventLabel: 'Listing went live from update',
        property: updated,
      }).catch((err) => {
        console.error('[Update] ❌ Market updates notification failed:', err);
      });
    }

    if (updated && becameSold) {
      this.notifySavedPropertyActivity({
        property: updated,
        activity: 'sold',
        excludeUserId: user.userId,
      }).catch((err) => {
        console.error('[Update] ❌ Favorites sold notification failed:', err);
      });
    }

    if (updated && becameRented) {
      this.notifySavedPropertyActivity({
        property: updated,
        activity: 'rented',
        excludeUserId: user.userId,
      }).catch((err) => {
        console.error('[Update] ❌ Favorites rented notification failed:', err);
      });
    }

    if (updated && becameDelisted) {
      this.notifySavedPropertyActivity({
        property: updated,
        activity: 'desisted',
        excludeUserId: user.userId,
      }).catch((err) => {
        console.error(
          '[Update] ❌ Favorites delisted notification failed:',
          err,
        );
      });
    }

    // Generate signed URLs for response
    if (updated) {
      console.log(`[Update] Generating signed URLs for response...`);

      const imagesSignedUrls: string[] = await Promise.all(
        (updated.images || []).map(async (img: any) => {
          return await this.awsService.generateSignedUrl(img.key);
        }),
      );

      let thumbnailSignedUrl: string | undefined;
      if (updated.thumbnail?.key) {
        thumbnailSignedUrl = await this.awsService.generateSignedUrl(
          updated.thumbnail.key,
        );
      }

      console.log(
        `[Update] Signed URLs generated: ${imagesSignedUrls.length} images, thumbnail: ${!!thumbnailSignedUrl}`,
      );
      console.log('========== 🔄 PROPERTY UPDATE COMPLETED ==========\n');

      return {
        ...updated,
        moreDetails: updated.moreDetails ?? '',
        propertyOwner:
          updated.propertyOwner?.toString?.() ?? String(updated.propertyOwner),
        images: imagesSignedUrls,
        thumbnail: thumbnailSignedUrl,
      };
    }

    console.log('========== 🔄 PROPERTY UPDATE COMPLETED ==========\n');
    return updated;
  }

  async remove(id: MongoIdDto['id'], user: AuthUser) {
    const property = await this.propertyModel
      .findById(id)
      .select(
        'propertyOwner propertyName propertyType address isPublished status',
      )
      .lean();

    if (!property) throw new NotFoundException('Property not found');

    if (String(property.propertyOwner) !== String(user.userId)) {
      throw new ForbiddenException('Forbidden');
    }

    const deleted = await this.propertyModel.deleteOne({ _id: id });

    if (deleted.deletedCount && property) {
      this.notifySavedPropertyActivity({
        property,
        activity: 'desisted',
        excludeUserId: user.userId,
      }).catch((err) => {
        console.error(
          '[Remove] ❌ Favorites delisted notification failed:',
          err,
        );
      });
    }

    return deleted;
  }

async topFourProperty() {
  const page = 1;
  const limit = 4;
  const total = await this.propertyModel.countDocuments();

  const properties = await this.propertyModel
    .find()
    .sort({ createdAt: -1 }) // newest first
    .limit(limit) // only 4 items
    .lean();

  const propertiesWithSignedUrls = await Promise.all(
    properties.map(async (prop: any) => {
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
}
