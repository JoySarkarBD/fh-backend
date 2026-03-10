/**
 * @fileoverview Core Chat service.
 *
 * Handles all MongoDB interactions for the chat system:
 *   - Creating / finding conversations
 *   - Listing conversations per user
 *   - Cursor-paginated message history
 *   - Bulk message persistence (called by the RabbitMQ consumer)
 *   - Updating lastMessage snapshot on Conversation after flush
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from 'src/schemas/conversation.schema';
import { Message, MessageDocument as MessageDoc } from 'src/schemas/message.schema';
import { MessageStatus } from 'src/schemas/message.schema';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import {
  MessageDocument,
  MessagePayload,
  MessageResponse,
  PaginatedMessages,
} from './interfaces/chat.interfaces';
import { AttachmentService } from './services/attachment.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,

    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDoc>,

    private readonly attachmentService: AttachmentService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERSATION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a new conversation or returns an existing one.
   *
   * For 1-on-1 chats: if a conversation already exists between the two
   * participants, it is returned instead of creating a duplicate.
   *
   * For group chats: always creates a new conversation.
   *
   * @param dto    - Validated CreateConversationDto from the controller.
   * @param userId - Authenticated user's MongoDB ObjectId string.
   */
  async createConversation(
    dto: CreateConversationDto,
    userId: string,
  ): Promise<ConversationDocument> {
    // Combine the requesting user with the given participant IDs
    const allParticipantIds = [
      userId,
      ...dto.participantIds,
    ].map((id) => new Types.ObjectId(id));

    // Remove duplicate IDs in case the client accidentally included themselves
    const uniqueIds = [
      ...new Map(allParticipantIds.map((id) => [id.toString(), id])).values(),
    ];

    // For 1-on-1 conversations, try to find an existing one first
    if (uniqueIds.length === 2) {
      const existing = await this.conversationModel.findOne({
        // $all with $size guarantees EXACT match (no extra participants)
        participants: { $all: uniqueIds, $size: 2 },
      });
      if (existing) {
        this.logger.debug(`Reusing existing 1-on-1 conversation: ${existing._id}`);
        return existing;
      }
    }

    const conversation = await this.conversationModel.create({
      participants: uniqueIds,
    });
    this.logger.log(`Created new conversation: ${conversation._id}`);
    return conversation;
  }

  /**
   * Returns a cursor-paginated page of conversations for a user,
   * sorted by most recent activity (newest first).
   *
   * HOW CURSOR PAGINATION WORKS:
   *   - On the first request: no cursor → return the latest `limit` conversations.
   *   - On subsequent requests: cursor = ISO timestamp of the OLDEST conversation
   *     from the previous page → fetch conversations with `lastMessageAt` OLDER
   *     than that timestamp (scroll-down loads older chats).
   *
   * @param userId - Authenticated user's MongoDB ObjectId string.
   * @param cursor - Optional ISO-8601 timestamp cursor from a previous response.
   * @param limit  - Number of conversations per page (default 20).
   */
  async getUserConversations(
    userId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{
    conversations: ConversationDocument[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const query: Record<string, unknown> = {
      participants: new Types.ObjectId(userId),
    };

    // If cursor provided, only fetch conversations older than the cursor timestamp
    if (cursor) {
      query['lastMessageAt'] = { $lt: new Date(cursor) };
    }

    // Fetch one extra record to determine whether there are more pages
    const fetchLimit = limit + 1;

    const rawConversations = await this.conversationModel
      .find(query)
      .sort({ lastMessageAt: -1 })
      .limit(fetchLimit)
      .select('-__v')
      .lean()
      .exec() as unknown as ConversationDocument[];

    const hasMore = rawConversations.length > limit;
    const conversations = hasMore
      ? rawConversations.slice(0, limit)
      : rawConversations;

    // nextCursor = lastMessageAt of the last item in this page
    const lastConv = conversations[conversations.length - 1];
    const nextCursor =
      hasMore && lastConv
        ? (lastConv as unknown as { lastMessageAt?: string }).lastMessageAt ?? null
        : null;

    return { conversations, nextCursor, hasMore };
  }


  /**
   * Validates that a conversation exists and that the requesting user
   * is a participant.  Throws 404 / 403 as appropriate.
   *
   * @param conversationId - MongoDB ObjectId string.
   * @param userId         - Authenticated user's ObjectId string.
   */
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

  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns a cursor-paginated page of messages for a conversation.
   *
   * HOW CURSOR PAGINATION WORKS:
   *   - Messages are ordered by `createdAt` descending (newest first).
   *   - On the first request: no cursor → return the latest N messages.
   *   - On subsequent requests: cursor = ISO timestamp of the OLDEST message
   *     from the previous page → fetch messages OLDER than that timestamp.
   *   - Client scrolls UP → calls with `nextCursor` from the last response.
   *
   * @param dto - Validated GetMessagesDto (conversationId, cursor, limit).
   * @param userId - Authenticated user's MongoDB ObjectId string.
   */
  async getMessages(dto: GetMessagesDto, userId: string): Promise<PaginatedMessages> {
    const limit = dto.limit ?? 20;
    const query: Record<string, unknown> = {
      conversationId: new Types.ObjectId(dto.conversationId),
      deletedForUsers: { $ne: new Types.ObjectId(userId) },
    };

    // Apply cursor: only fetch messages OLDER than the cursor timestamp
    if (dto.cursor) {
      query.createdAt = { $lt: new Date(dto.cursor) };
    }

    const messages = await this.messageModel
      .find(query)
      .sort({ createdAt: -1 }) // Newest first within this page
      .limit(limit)
      .lean()
      .exec();

    // The nextCursor is the createdAt of the OLDEST message on this page.
    // Clients pass this on the next call to load even older messages.
    const nextCursor =
      messages.length === limit
        ? (messages[messages.length - 1].createdAt as Date).toISOString()
        : null;

    return {
      messages: messages.map((m) => ({
        _id: m._id.toString(),
        conversationId: m.conversationId.toString(),
        senderId: m.senderId.toString(),
        message: m.message,
        attachments: m.attachments,
        status: m.status,
        isForwarded: m.isForwarded,
        originalMessageId: m.originalMessageId ? m.originalMessageId.toString() : null,
        forwardedBy: m.forwardedBy ? m.forwardedBy.toString() : null,
        isUnsent: m.isUnsent,
        createdAt: (m.createdAt as Date).toISOString(),
      })) as MessageResponse[],
      nextCursor,
      count: messages.length,
    };
  }

  /**
   * Bulk-persists an array of message payloads to MongoDB.
   *
   * Called ONLY by the RabbitMQ consumer (ChatMessageConsumer) during a
   * batch flush.  Uses `insertMany` with `ordered: false` so a single
   * validation failure does not block the rest of the batch.
   *
   * After saving, updates the `lastMessage` / `lastMessageAt` snapshot
   * on all affected conversations in a single bulk write.
   *
   * @param payloads - Array of MessagePayload objects from RabbitMQ.
   * @returns        - Number of messages successfully saved.
   */
  async bulkSaveMessages(payloads: MessagePayload[]): Promise<number> {
    if (payloads.length === 0) return 0;

    const docs: MessageDocument[] = payloads.map((p) => ({
      _id: new Types.ObjectId(p._id),
      conversationId: new Types.ObjectId(p.conversationId),
      senderId: new Types.ObjectId(p.senderId),
      message: p.message,
      attachments: p.attachments ?? [],
      status: p.status ?? MessageStatus.SENT,
      isForwarded: p.isForwarded ?? false,
      originalMessageId: p.originalMessageId ? new Types.ObjectId(p.originalMessageId) : null,
      forwardedBy: p.forwardedBy ? new Types.ObjectId(p.forwardedBy) : null,
      isUnsent: p.isUnsent ?? false,
      deletedForUsers: p.deletedForUsers ? p.deletedForUsers.map(id => new Types.ObjectId(id)) : [],
      createdAt: new Date(p.createdAt),
    }));

    // Bulk insert — ordered: false means partial success is acceptable
    const result = await this.messageModel.insertMany(docs, { ordered: false });
    const savedCount = result.length;

    this.logger.log(`Bulk saved ${savedCount}/${payloads.length} messages to MongoDB`);

    // ── Update lastMessage snapshot on each conversation ──────────────────
    // Group messages by conversationId and pick the most recent one
    const latestByConversation = new Map<string, MessagePayload>();
    for (const payload of payloads) {
      const existing = latestByConversation.get(payload.conversationId);
      if (!existing || new Date(payload.createdAt) > new Date(existing.createdAt)) {
        latestByConversation.set(payload.conversationId, payload);
      }
    }

    // Build a bulkWrite operation to update all affected conversations at once
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
      this.logger.debug(
        `Updated lastMessage on ${conversationUpdates.length} conversation(s)`,
      );
    }

    return savedCount;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EVENT-DRIVEN MESSAGE MUTATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Unsends a message. Sets isUnsent to true, clears text, and removes attachments.
   * If attachments exist, safely deletes them from S3 (if unused elsewhere).
   * @returns true if message was found and updated, otherwise false.
   */
  async unsendMessage(messageId: string, userId: string): Promise<boolean> {
    const msg = await this.messageModel.findOne({
      _id: new Types.ObjectId(messageId),
      senderId: new Types.ObjectId(userId),
    });

    if (!msg) return false;
    if (msg.isUnsent) return true; // Already unsent

    const attachmentsToClean = msg.attachments ? [...msg.attachments] : [];

    msg.isUnsent = true;
    msg.message = 'This message was unsent';
    msg.attachments = [];
    await msg.save();

    // After saving changes, evaluate S3 files for cleanup safely
    for (const att of attachmentsToClean) {
      await this.attachmentService.deleteAttachmentIfUnused(att.key);
    }

    return true;
  }

  /**
   * Marks a message as deleted for the specified user (only hides it from their view).
   */
  async deleteMessageForMe(messageId: string, userId: string): Promise<boolean> {
    const result = await this.messageModel.updateOne(
      { _id: new Types.ObjectId(messageId) },
      { $addToSet: { deletedForUsers: new Types.ObjectId(userId) } }
    );
    return result.modifiedCount > 0 || result.matchedCount > 0;
  }

  /**
   * Removes a single attachment from a message by key, and safely deletes from S3 if unused.
   */
  async deleteAttachmentFromMessage(messageId: string, attachmentKey: string, userId: string): Promise<boolean> {
    const msg = await this.messageModel.findOne({
      _id: new Types.ObjectId(messageId),
      senderId: new Types.ObjectId(userId), // Only sender can remove attachment
    });

    if (!msg || !msg.attachments) return false;

    const attachmentIndex = msg.attachments.findIndex((a) => a.key === attachmentKey);
    if (attachmentIndex === -1) return false;

    // Remove it from array
    msg.attachments.splice(attachmentIndex, 1);
    await msg.save();

    // Check if we can delete from S3
    await this.attachmentService.deleteAttachmentIfUnused(attachmentKey);

    return true;
  }
}
