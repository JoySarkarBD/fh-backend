/**
 * @fileoverview RabbitMQ consumer for the chat message queue.
 *
 * ─── BATCH FLUSH STRATEGY ────────────────────────────────────────────────────
 *
 *   1. Each incoming RabbitMQ message is pushed into `messageBuffer[]`.
 *   2. The RMQ channel.ack() is called immediately after buffering —
 *      message is removed from RabbitMQ queue (acknowledged).
 *   3. Buffer flushes to MongoDB when EITHER condition is met:
 *        a.  buffer.length >= BATCH_SIZE (3000 messages)
 *        b.  FLUSH_INTERVAL_MS (30 seconds) timer fires
 *
 * ─── POISON MESSAGE PROTECTION ───────────────────────────────────────────────
 *
 * Messages that fail processing more than MAX_RETRY_COUNT times are permanently
 * rejected (nack without requeue) instead of being re-queued infinitely.
 *
 * A retry counter is tracked in-memory (per process) using the message's
 * unique `_id`. If you run multiple pods, configure RabbitMQ Dead Letter
 * Exchanges (DLX) at the broker level for cross-pod retry protection.
 *
 * ─── MEMORY SAFETY ───────────────────────────────────────────────────────────
 *
 * Buffer is bounded:
 *   - Each flush clears the buffer with `splice(0)`.
 *   - At 3000-msg cap, ~3000 × ~200 bytes ≈ 600 KB peak RAM — negligible.
 *
 * ─── SHUTDOWN SAFETY ─────────────────────────────────────────────────────────
 *
 * onModuleDestroy() flushes the remaining buffer before the process exits,
 * so no data is lost on graceful shutdown (SIGTERM / SIGINT).
 */

import { Inject, Controller, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { ChatService } from '../chat.service';
import { Message, MessageDocument } from 'src/schemas/message.schema';
import type { MessagePayload } from '../interfaces/chat.interfaces';
import { REDIS_COMMANDS } from 'src/redis/redis.constants';
import Redis from 'ioredis';

/** Maximum consecutive failures before a message is dead-lettered (dropped). */
const MAX_RETRY_COUNT = 3;

@Controller()
export class ChatMessageConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatMessageConsumer.name);

  /**
   * Maximum number of messages to accumulate before forcing a DB flush.
   * At ~200 bytes per payload this is ~600 KB of peak buffer memory.
   */
  private readonly BATCH_SIZE = 3000;

  /**
   * Maximum milliseconds between flushes under low-traffic conditions.
   * Ensures messages are never stuck in memory longer than 30 seconds.
   */
  private readonly FLUSH_INTERVAL_MS = 30_000;

  /** In-memory buffer that accumulates messages between flushes. */
  private messageBuffer: MessagePayload[] = [];

  /** NodeJS interval handle — used to cancel on module destroy. */
  private flushTimer!: NodeJS.Timeout;

  /** Guards against concurrent flush calls colliding on the same buffer. */
  private isFlushing = false;

  /**
   * In-process retry counter for poison messages.
   * Key: message _id  |  Value: number of failed processing attempts.
   */
  private retryCounter = new Map<string, number>();

  constructor(
    private readonly chatService: ChatService,
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    @Inject(REDIS_COMMANDS.REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // LIFECYCLE HOOKS
  // ───────────────────────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.flushTimer = setInterval(async () => {
      if (this.messageBuffer.length > 0) {
        this.logger.log(
          `[Timer] Flushing ${this.messageBuffer.length} buffered messages (30s timeout)`,
        );
        await this.flushBuffer();
      }
    }, this.FLUSH_INTERVAL_MS);

    this.logger.log(
      `Chat message consumer ready — batch size: ${this.BATCH_SIZE}, interval: ${this.FLUSH_INTERVAL_MS / 1000}s, max retries: ${MAX_RETRY_COUNT}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);

    if (this.messageBuffer.length > 0) {
      this.logger.warn(
        `[Shutdown] Flushing remaining ${this.messageBuffer.length} messages before exit`,
      );
      await this.flushBuffer();
    }

    this.logger.log('Chat message consumer shut down cleanly');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Returns whether this message has exceeded the retry limit.
   * If so, logs a warning and clears it from the counter.
   */
  private shouldDeadLetter(id: string): boolean {
    const count = (this.retryCounter.get(id) ?? 0) + 1;
    this.retryCounter.set(id, count);

    if (count >= MAX_RETRY_COUNT) {
      this.logger.error(
        `[DLQ] Message ${id} has failed ${count} times — dead-lettering (dropping permanently).`,
      );
      this.retryCounter.delete(id); // Clean up counter
      return true;
    }

    this.logger.warn(`[Retry ${count}/${MAX_RETRY_COUNT}] Re-queueing message ${id}`);
    return false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RABBITMQ EVENT HANDLERS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Receives individual messages from the 'chat_message_queue'.
   *
   * The handler is intentionally lightweight:
   *   1. Push onto buffer.
   *   2. ACK immediately (remove from RabbitMQ).
   *   3. Trigger flush if buffer is full.
   */
  @EventPattern('chat_message')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleChatMessage(
    @Payload() payload: MessagePayload,
    @Ctx() context: any,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      this.messageBuffer.push(payload);
      channel.ack(originalMsg);
      this.retryCounter.delete(payload._id); // Reset retry count on success

      this.logger.debug(
        `Buffered message for conversation ${payload.conversationId} — buffer: ${this.messageBuffer.length}/${this.BATCH_SIZE}`,
      );

      if (this.messageBuffer.length >= this.BATCH_SIZE) {
        this.logger.log(
          `[Batch] Buffer full (${this.BATCH_SIZE} messages). Triggering flush.`,
        );
        await this.flushBuffer();
      }
    } catch (error) {
      this.logger.error('Failed to buffer chat message', error);
      const isDLQ = this.shouldDeadLetter(payload._id);
      // If DLQ, nack without requeue to permanently discard
      // Otherwise nack with requeue for another attempt
      channel.nack(originalMsg, false, !isDLQ);
    }
  }

  @EventPattern('message_unsent')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleMessageUnsent(@Payload() payload: { messageId: string; conversationId: string; userId: string }, @Ctx() context: any): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      const inBuffer = this.messageBuffer.find(m => m._id === payload.messageId);
      if (inBuffer && inBuffer.senderId === payload.userId) {
        inBuffer.isUnsent = true;
        inBuffer.message = 'This message was unsent';
        inBuffer.attachments = [];
        channel.ack(originalMsg);
        this.retryCounter.delete(payload.messageId);
        return;
      }
      await this.chatService.unsendMessage(payload.messageId, payload.userId);
      channel.ack(originalMsg);
      this.retryCounter.delete(payload.messageId);
    } catch (error) {
      this.logger.error('Failed to process message_unsent', error);
      const isDLQ = this.shouldDeadLetter(payload.messageId);
      channel.nack(originalMsg, false, !isDLQ);
    }
  }

  @EventPattern('message_deleted_for_me')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleMessageDeletedForMe(@Payload() payload: { messageId: string; conversationId: string; userId: string }, @Ctx() context: any): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      const inBuffer = this.messageBuffer.find(m => m._id === payload.messageId);
      if (inBuffer) {
        inBuffer.deletedForUsers = inBuffer.deletedForUsers || [];
        inBuffer.deletedForUsers.push(payload.userId);
        channel.ack(originalMsg);
        this.retryCounter.delete(payload.messageId);
        return;
      }
      // Check message existence before attempting delete to avoid orphan NACKs
      const exists = await this.messageModel.exists({ _id: new Types.ObjectId(payload.messageId) });
      if (!exists) {
        this.logger.warn(`[deleteForMe] Message ${payload.messageId} not found — acking as non-retryable`);
        channel.ack(originalMsg); // Message gone — no point re-queueing
        return;
      }
      await this.chatService.deleteMessageForMe(payload.messageId, payload.userId);
      channel.ack(originalMsg);
      this.retryCounter.delete(payload.messageId);
    } catch (error) {
      this.logger.error('Failed to process message_deleted_for_me', error);
      const isDLQ = this.shouldDeadLetter(payload.messageId);
      channel.nack(originalMsg, false, !isDLQ);
    }
  }

  @EventPattern('attachment_deleted')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleAttachmentDeleted(@Payload() payload: { messageId: string; conversationId: string; attachmentKey: string; userId: string }, @Ctx() context: any): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      const inBuffer = this.messageBuffer.find(m => m._id === payload.messageId);
      if (inBuffer && inBuffer.senderId === payload.userId && inBuffer.attachments) {
        inBuffer.attachments = inBuffer.attachments.filter(a => a.key !== payload.attachmentKey);
        channel.ack(originalMsg);
        this.retryCounter.delete(payload.messageId);
        return;
      }
      const exists = await this.messageModel.exists({ _id: new Types.ObjectId(payload.messageId) });
      if (!exists) {
        this.logger.warn(`[attachment_deleted] Message ${payload.messageId} not found — acking`);
        channel.ack(originalMsg);
        return;
      }
      await this.chatService.deleteAttachmentFromMessage(payload.messageId, payload.attachmentKey, payload.userId);
      channel.ack(originalMsg);
      this.retryCounter.delete(payload.messageId);
    } catch (error) {
      this.logger.error('Failed to process attachment_deleted', error);
      const isDLQ = this.shouldDeadLetter(payload.messageId);
      channel.nack(originalMsg, false, !isDLQ);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PRIVATE FLUSH LOGIC
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Atomically drains the buffer and persists all messages to MongoDB.
   *
   * Uses `splice(0)` to atomically swap the buffer — new incoming messages
   * buffered during an in-flight flush go into a fresh (empty) array and
   * will be picked up on the next flush cycle.
   */
  private async flushBuffer(): Promise<void> {
    if (this.isFlushing) {
      this.logger.debug('Flush already in progress — skipping concurrent call');
      return;
    }

    if (this.messageBuffer.length === 0) return;

    this.isFlushing = true;

    // Atomically take all buffered messages
    const batch = this.messageBuffer.splice(0);

    try {
      const savedCount = await this.chatService.bulkSaveMessages(batch);
      this.logger.log(
        `✅ Flush complete: ${savedCount}/${batch.length} messages saved to MongoDB`,
      );

      // ── Clean up Redis write-through buffer ───────────────────────────────
      // Messages are now in MongoDB, so remove them from Redis to prevent
      // duplicate results when getChatMessages merges Redis + MongoDB.
      //
      // Grouped by conversationId to build one ZREM command per conversation.
      const pipeline = this.redis.pipeline();
      const convIds = new Map<string, string[]>(); // convId → [messageId, ...]

      for (const msg of batch) {
        pipeline.del(`chat:msg:${msg._id}`);
        if (!convIds.has(msg.conversationId)) convIds.set(msg.conversationId, []);
        convIds.get(msg.conversationId)!.push(msg._id);
      }

      for (const [convId, msgIds] of convIds) {
        pipeline.zrem(`chat:buf:${convId}`, ...msgIds);
      }

      // Fire-and-forget — cleanup is best-effort; 90s TTL is the safety net
      pipeline.exec().catch((err) =>
        this.logger.warn('Redis cleanup after flush failed (non-fatal):', err),
      );
    } catch (error) {
      this.logger.error(
        `Flush failed for batch of ${batch.length} messages`,
        error,
      );
      // Re-buffer on failure so the next timer cycle will retry.
      this.messageBuffer.unshift(...batch);
    } finally {
      this.isFlushing = false;
    }
  }
}
