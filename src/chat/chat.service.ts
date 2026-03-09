import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AwsService } from 'src/common/aws/aws.service';
import { Conversation, ConversationDocument } from 'src/schemas/conversation.schema';
import { Message, MessageDocument as MessageDoc, MessageStatus } from 'src/schemas/message.schema';
import { User, UserDocument } from 'src/schemas/user.schema';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import {
  MessageDocument,
  MessagePayload,
  MessageResponse,
  PaginatedMessages,
} from './interfaces/chat.interfaces';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDoc>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly awsService: AwsService,
  ) {}

  async createConversation(
    dto: CreateConversationDto,
    userId: string,
  ): Promise<ConversationDocument> {
    const allParticipantIds = [userId, ...dto.participantIds].map(
      (id) => new Types.ObjectId(id),
    );

    const uniqueIds = [
      ...new Map(allParticipantIds.map((id) => [id.toString(), id])).values(),
    ];

    const propertyObjectId = dto.propertyId
      ? new Types.ObjectId(dto.propertyId)
      : null;

    if (uniqueIds.length === 2) {
      const sortedIds = uniqueIds
        .map((id) => id.toString())
        .sort((a, b) => a.localeCompare(b));
      const directKey = `${sortedIds[0]}:${sortedIds[1]}:${propertyObjectId?.toString() ?? 'none'}`;

      const existing = await this.conversationModel.findOne({
        participants: { $all: uniqueIds, $size: 2 },
        ...(propertyObjectId
          ? { propertyId: propertyObjectId }
          : { $or: [{ propertyId: { $exists: false } }, { propertyId: null }] }),
      });

      if (existing) {
        if (!existing.directKey) {
          try {
            existing.directKey = directKey;
            await existing.save();
          } catch {
            // ignore duplicate key race; existing conversation can still be used
          }
        }
        return existing;
      }

      try {
        const upserted = await this.conversationModel.findOneAndUpdate(
          { directKey },
          {
            $setOnInsert: {
              participants: uniqueIds,
              propertyId: propertyObjectId,
              directKey,
            },
          },
          { new: true, upsert: true },
        );
        if (upserted) {
          return upserted as unknown as ConversationDocument;
        }
      } catch {
        const fallback = await this.conversationModel.findOne({ directKey });
        if (fallback) return fallback;
      }
    }

    const conversation = await this.conversationModel.create({
      participants: uniqueIds,
      propertyId: propertyObjectId,
    });

    return conversation;
  }

  async getUserConversations(userId: string): Promise<any[]> {
    const userObjectId = new Types.ObjectId(userId);

    const conversations = await this.conversationModel
      .find({ participants: userObjectId })
      .populate({
        path: 'participants',
        select: 'name email profileImage isOnline lastActiveAt',
      })
      .populate({
        path: 'propertyId',
        select:
          'propertyName address price bedrooms bathrooms squareFeet thumbnail',
      })
      .sort({ lastMessageAt: -1 })
      .lean()
      .exec();

    const mapped = await Promise.all(
      conversations.map(async (conversation: any) => {
        const unreadCount = await this.messageModel.countDocuments({
          conversationId: conversation._id,
          senderId: { $ne: userObjectId },
          status: { $ne: MessageStatus.SEEN },
          unsentForEveryone: { $ne: true },
          deletedFor: { $ne: userObjectId },
        });

        const participants = (conversation.participants || []).map((p: any) => ({
          _id: p?._id?.toString?.() ?? String(p?._id),
          name: p?.name,
          email: p?.email,
          profileImage: p?.profileImage,
          isOnline: Boolean(p?.isOnline),
          lastActiveAt: p?.lastActiveAt ? new Date(p.lastActiveAt).toISOString() : null,
        }));

        return {
          _id: conversation._id?.toString?.() ?? String(conversation._id),
          participants,
          property: await this.mapConversationProperty(conversation.propertyId),
          lastMessage: conversation.lastMessage || '',
          lastMessageAt: conversation.lastMessageAt
            ? new Date(conversation.lastMessageAt).toISOString()
            : null,
          unreadCount,
          _counterpartyId:
            participants.find((p: any) => p._id !== userId)?._id ?? '',
        };
      }),
    );

    const deduped = new Map<string, any>();
    for (const item of mapped) {
      const key = `${item._counterpartyId}:${item.property?._id ?? 'none'}`;
      if (!deduped.has(key)) {
        deduped.set(key, item);
      }
    }

    return [...deduped.values()].map((item) => {
      const { _counterpartyId, ...rest } = item;
      return rest;
    });
  }

  async getConversationByIdForUser(
    conversationId: string,
    userId: string,
  ): Promise<any | null> {
    const userObjectId = new Types.ObjectId(userId);
    const conversation = await this.conversationModel
      .findOne({
        _id: new Types.ObjectId(conversationId),
        participants: userObjectId,
      })
      .populate({
        path: 'participants',
        select: 'name email profileImage isOnline lastActiveAt',
      })
      .populate({
        path: 'propertyId',
        select:
          'propertyName address price bedrooms bathrooms squareFeet thumbnail',
      })
      .lean()
      .exec();

    if (!conversation) return null;

    const unreadCount = await this.messageModel.countDocuments({
      conversationId: conversation._id,
      senderId: { $ne: userObjectId },
      status: { $ne: MessageStatus.SEEN },
      unsentForEveryone: { $ne: true },
      deletedFor: { $ne: userObjectId },
    });

    const participants = (conversation.participants || []).map((p: any) => ({
      _id: p?._id?.toString?.() ?? String(p?._id),
      name: p?.name,
      email: p?.email,
      profileImage: p?.profileImage,
      isOnline: Boolean(p?.isOnline),
      lastActiveAt: p?.lastActiveAt
        ? new Date(p.lastActiveAt).toISOString()
        : null,
    }));

    return {
      _id: conversation._id?.toString?.() ?? String(conversation._id),
      participants,
      property: await this.mapConversationProperty(conversation.propertyId),
      lastMessage: conversation.lastMessage || '',
      lastMessageAt: conversation.lastMessageAt
        ? new Date(conversation.lastMessageAt).toISOString()
        : null,
      unreadCount,
    };
  }

  async getConversationParticipantIds(conversationId: string): Promise<string[]> {
    const conversation = await this.conversationModel
      .findById(new Types.ObjectId(conversationId))
      .select('participants')
      .lean();
    if (!conversation) return [];
    return (conversation.participants || []).map((id: any) =>
      id?.toString?.() ?? String(id),
    );
  }

  async validateParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ConversationDocument> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversationId format');
    }

    const conversation = await this.conversationModel.findOne({
      _id: new Types.ObjectId(conversationId),
      participants: new Types.ObjectId(userId),
    });

    if (!conversation) {
      throw new NotFoundException(
        'Conversation not found or you are not a participant',
      );
    }

    return conversation;
  }

  async getMessages(dto: GetMessagesDto, userId: string): Promise<PaginatedMessages> {
    await this.validateParticipant(dto.conversationId, userId);

    const limit = dto.limit ?? 20;
    const userObjectId = new Types.ObjectId(userId);

    const query: Record<string, unknown> = {
      conversationId: new Types.ObjectId(dto.conversationId),
      deletedFor: { $ne: userObjectId },
    };

    if (dto.cursor) {
      query.createdAt = { $lt: new Date(dto.cursor) };
    }

    const messages = await this.messageModel
      .find(query)
      .populate({
        path: 'senderId',
        select: 'name profileImage isOnline lastActiveAt',
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    const nextCursor =
      messages.length === limit
        ? (messages[messages.length - 1].createdAt as Date).toISOString()
        : null;

    return {
      messages: messages.map((m: any) => this.mapMessageResponse(m)),
      nextCursor,
      count: messages.length,
    };
  }

  async createMessage(dto: CreateMessageDto, userId: string): Promise<MessageResponse> {
    await this.validateParticipant(dto.conversationId, userId);

    const messageText = (dto.message ?? '').trim();
    const attachments = dto.attachments ?? [];

    if (!messageText && attachments.length === 0) {
      throw new BadRequestException('Message text or attachments are required');
    }

    const createdAt = new Date();
    const created = await this.messageModel.create({
      conversationId: new Types.ObjectId(dto.conversationId),
      senderId: new Types.ObjectId(userId),
      message: messageText,
      attachments,
      status: MessageStatus.SENT,
      unsentForEveryone: false,
      deletedFor: [],
      createdAt,
    });

    await this.conversationModel.updateOne(
      { _id: new Types.ObjectId(dto.conversationId) },
      {
        $set: {
          lastMessage: messageText || 'Attachment',
          lastMessageAt: createdAt,
        },
      },
    );

    const populated = await this.messageModel
      .findById(created._id)
      .populate({
        path: 'senderId',
        select: 'name profileImage isOnline lastActiveAt',
      })
      .lean()
      .exec();

    if (!populated) {
      throw new NotFoundException('Message not found after creation');
    }

    return this.mapMessageResponse(populated as any);
  }

  async unsendMessage(messageId: string, userId: string) {
    if (!Types.ObjectId.isValid(messageId)) {
      throw new BadRequestException('Invalid messageId format');
    }

    const updated = await this.messageModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(messageId),
        senderId: new Types.ObjectId(userId),
      },
      {
        $set: {
          unsentForEveryone: true,
          message: '',
          attachments: [],
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Message not found');
    }

    const conversationId = updated.conversationId.toString();
    await this.refreshConversationLastMessage(conversationId);

    return {
      success: true,
      messageId: updated._id.toString(),
      conversationId,
      message: {
        _id: updated._id.toString(),
        conversationId,
        senderId: updated.senderId.toString(),
        message: '',
        attachments: [],
        status: updated.status,
        unsentForEveryone: true,
        forwardedFrom: updated.forwardedFrom
          ? updated.forwardedFrom.toString()
          : null,
        deletedFor: Array.isArray(updated.deletedFor)
          ? updated.deletedFor.map((id: any) => id?.toString?.() ?? String(id))
          : [],
        createdAt: new Date(updated.createdAt).toISOString(),
      } as MessageResponse,
    };
  }

  async deleteMessageForMe(messageId: string, userId: string) {
    if (!Types.ObjectId.isValid(messageId)) {
      throw new BadRequestException('Invalid messageId format');
    }

    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.validateParticipant(message.conversationId.toString(), userId);

    const conversationId = message.conversationId.toString();
    await this.messageModel.updateOne(
      { _id: new Types.ObjectId(messageId) },
      { $addToSet: { deletedFor: new Types.ObjectId(userId) } },
    );

    return { success: true, messageId, conversationId, userId };
  }

  async forwardMessage(
    messageId: string,
    dto: ForwardMessageDto,
    userId: string,
  ): Promise<MessageResponse> {
    if (!Types.ObjectId.isValid(messageId)) {
      throw new BadRequestException('Invalid messageId format');
    }

    const sourceMessage = await this.messageModel.findById(messageId).lean();
    if (!sourceMessage) {
      throw new NotFoundException('Source message not found');
    }

    await this.validateParticipant(sourceMessage.conversationId.toString(), userId);
    await this.validateParticipant(dto.targetConversationId, userId);

    if (sourceMessage.unsentForEveryone) {
      throw new BadRequestException('Cannot forward an unsent message');
    }

    const createdAt = new Date();
    const created = await this.messageModel.create({
      conversationId: new Types.ObjectId(dto.targetConversationId),
      senderId: new Types.ObjectId(userId),
      message: sourceMessage.message,
      attachments: sourceMessage.attachments ?? [],
      status: MessageStatus.SENT,
      unsentForEveryone: false,
      forwardedFrom: sourceMessage._id,
      deletedFor: [],
      createdAt,
    });

    await this.conversationModel.updateOne(
      { _id: new Types.ObjectId(dto.targetConversationId) },
      {
        $set: {
          lastMessage: sourceMessage.message || 'Attachment',
          lastMessageAt: createdAt,
        },
      },
    );

    const populated = await this.messageModel
      .findById(created._id)
      .populate({
        path: 'senderId',
        select: 'name profileImage isOnline lastActiveAt',
      })
      .lean()
      .exec();

    if (!populated) {
      throw new NotFoundException('Forwarded message not found after creation');
    }

    return this.mapMessageResponse(populated as any);
  }

  async markConversationSeen(conversationId: string, userId: string) {
    await this.validateParticipant(conversationId, userId);

    const result = await this.messageModel.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        senderId: { $ne: new Types.ObjectId(userId) },
        status: { $ne: MessageStatus.SEEN },
        deletedFor: { $ne: new Types.ObjectId(userId) },
      },
      { $set: { status: MessageStatus.SEEN } },
    );

    return { modifiedCount: result.modifiedCount };
  }

  async setUserPresence(userId: string, isOnline: boolean): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }

    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          isOnline,
          ...(isOnline ? {} : { lastActiveAt: new Date() }),
        },
      },
    );
  }

  async getPresence(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId format');
    }

    const user = await this.userModel
      .findById(new Types.ObjectId(userId))
      .select('isOnline lastActiveAt name')
      .lean();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      userId,
      name: user.name,
      isOnline: Boolean(user.isOnline),
      lastActiveAt: user.lastActiveAt
        ? new Date(user.lastActiveAt).toISOString()
        : null,
    };
  }

  async bulkSaveMessages(payloads: MessagePayload[]): Promise<number> {
    if (payloads.length === 0) return 0;

    const docs: MessageDocument[] = payloads.map((p) => ({
      conversationId: new Types.ObjectId(p.conversationId),
      senderId: new Types.ObjectId(p.senderId),
      message: p.message,
      attachments: p.attachments ?? [],
      status: p.status ?? MessageStatus.SENT,
      createdAt: new Date(p.createdAt),
    }));

    const result = await this.messageModel.insertMany(docs, { ordered: false });
    const savedCount = result.length;

    const latestByConversation = new Map<string, MessagePayload>();
    for (const payload of payloads) {
      const existing = latestByConversation.get(payload.conversationId);
      if (!existing || new Date(payload.createdAt) > new Date(existing.createdAt)) {
        latestByConversation.set(payload.conversationId, payload);
      }
    }

    const conversationUpdates = [...latestByConversation.values()].map((latest) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(latest.conversationId) },
        update: {
          $set: {
            lastMessage: latest.message,
            lastMessageAt: new Date(latest.createdAt),
          },
        },
      },
    }));

    if (conversationUpdates.length > 0) {
      await this.conversationModel.bulkWrite(conversationUpdates, {
        ordered: false,
      });
    }

    this.logger.log(`Bulk saved ${savedCount}/${payloads.length} messages`);

    return savedCount;
  }

  private async refreshConversationLastMessage(conversationId: string): Promise<void> {
    const latest = await this.messageModel
      .findOne({
        conversationId: new Types.ObjectId(conversationId),
      })
      .sort({ createdAt: -1 })
      .lean();

    if (!latest) {
      await this.conversationModel.updateOne(
        { _id: new Types.ObjectId(conversationId) },
        {
          $set: {
            lastMessage: '',
            lastMessageAt: null,
          },
        },
      );
      return;
    }

    const lastMessageText = latest.unsentForEveryone
      ? 'Message unsent'
      : latest.message || (latest.attachments?.length ? 'Attachment' : '');

    await this.conversationModel.updateOne(
      { _id: new Types.ObjectId(conversationId) },
      {
        $set: {
          lastMessage: lastMessageText,
          lastMessageAt: latest.createdAt,
        },
      },
    );
  }

  private mapMessageResponse(message: any): MessageResponse {
    const sender =
      message.senderId && typeof message.senderId === 'object'
        ? {
            _id: message.senderId._id?.toString?.() ?? String(message.senderId._id),
            name: message.senderId.name,
            profileImage: message.senderId.profileImage,
            isOnline: Boolean(message.senderId.isOnline),
            lastActiveAt: message.senderId.lastActiveAt
              ? new Date(message.senderId.lastActiveAt).toISOString()
              : null,
          }
        : undefined;

    return {
      _id: message._id?.toString?.() ?? String(message._id),
      conversationId:
        message.conversationId?._id?.toString?.() ??
        message.conversationId?.toString?.() ??
        String(message.conversationId),
      senderId:
        message.senderId?._id?.toString?.() ??
        message.senderId?.toString?.() ??
        String(message.senderId),
      message: message.message,
      attachments: message.attachments ?? [],
      status: message.status,
      unsentForEveryone: Boolean(message.unsentForEveryone),
      forwardedFrom: message.forwardedFrom
        ? message.forwardedFrom.toString?.() ?? String(message.forwardedFrom)
        : null,
      deletedFor: Array.isArray(message.deletedFor)
        ? message.deletedFor.map((id: any) => id?.toString?.() ?? String(id))
        : [],
      sender,
      createdAt: new Date(message.createdAt).toISOString(),
    };
  }

  private async mapConversationProperty(property: any) {
    if (!property || typeof property !== 'object') {
      return null;
    }

    let thumbnail: { key: string; image: string } | null = null;
    if (property?.thumbnail?.key) {
      thumbnail = {
        key: property.thumbnail.key,
        image: await this.awsService.generateSignedUrl(property.thumbnail.key),
      };
    }

    return {
      _id: property._id?.toString?.() ?? String(property._id),
      propertyName: property.propertyName,
      address: property.address,
      price: property.price,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      squareFeet: property.squareFeet,
      thumbnail,
    };
  }
}
