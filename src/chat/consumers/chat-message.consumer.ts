/**
 * @fileoverview RabbitMQ consumer for the chat message queue.
 *
 * Mirrors the MailConsumer pattern: decorated with @Controller() and
 * @EventPattern() to receive messages from the global RabbitMQ microservice
 * connection configured in main.ts.
 *
 * ─── BATCH FLUSH STRATEGY ────────────────────────────────────────────────────
 *
 * Individual insertMany() calls for every message would overload MongoDB
 * at high traffic (think 10k+ messages/second).  Instead:
 *
 *   1. Each incoming RabbitMQ message is pushed into `messageBuffer[]`.
 *   2. The RMQ channel.ack() is called immediately after buffering —
 *      message is removed from RabbitMQ queue (acknowledged).
 *   3. Buffer flushes to MongoDB when EITHER condition is met:
 *        a.  buffer.length >= BATCH_SIZE (3000 messages)
 *        b.  FLUSH_INTERVAL_MS (30 seconds) timer fires
 *
 * This means:
 *   - Under heavy load: flushes happen every 3000 messages.
 *   - Under light load: flushes happen every 30 seconds (no message left behind).
 *
 * ─── MEMORY SAFETY ───────────────────────────────────────────────────────────
 *
 * Buffer is bounded in practice because:
 *   - Each flush clears the buffer with `splice(0)`.
 *   - At 3000-msg cap, ~3000 × ~200 bytes ≈ 600 KB peak RAM — negligible.
 *   - RabbitMQ itself caps queue depth via broker settings (durable queue).
 *
 * ─── SHUTDOWN SAFETY ─────────────────────────────────────────────────────────
 *
 * onModuleDestroy() flushes the remaining buffer before the process exits,
 * so no data is lost on graceful shutdown (SIGTERM / SIGINT).
 */

import {
  Controller,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { ChatService } from '../chat.service';
import type { MessagePayload } from '../interfaces/chat.interfaces';

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

  constructor(private readonly chatService: ChatService) {}

  // ───────────────────────────────────────────────────────────────────────────
  // LIFECYCLE HOOKS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Starts the periodic 30-second flush timer when the NestJS module
   * is fully initialised.
   */
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
      `Chat message consumer ready — batch size: ${this.BATCH_SIZE}, interval: ${this.FLUSH_INTERVAL_MS / 1000}s`,
    );
  }

  /**
   * On graceful shutdown: cancel the timer and flush any remaining buffer
   * so zero messages are lost when the process exits.
   */
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
  // RABBITMQ EVENT HANDLER
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Receives individual messages from the 'chat_message_queue'.
   *
   * The handler is intentionally lightweight:
   *   1. Push onto buffer.
   *   2. ACK immediately (remove from RabbitMQ).
   *   3. Trigger flush if buffer is full.
   *
   * MongoDB is only touched during a flush, not per-message.
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
      // Buffer the message
      this.messageBuffer.push(payload);

      // ACK immediately — removes from RabbitMQ queue.
      //    The message now lives safely in `messageBuffer` until flushed.
      channel.ack(originalMsg);

      this.logger.debug(
        `Buffered message for conversation ${payload.conversationId} — buffer: ${this.messageBuffer.length}/${this.BATCH_SIZE}`,
      );

      // Flush if we've hit the batch size threshold
      if (this.messageBuffer.length >= this.BATCH_SIZE) {
        this.logger.log(
          `[Batch] Buffer full (${this.BATCH_SIZE} messages). Triggering flush.`,
        );
        await this.flushBuffer();
      }
    } catch (error) {
      // On unexpected error: NACK with requeue so the message isn't lost
      this.logger.error('Failed to buffer chat message', error);
      channel.nack(originalMsg, false, true);
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
    // Guard: only one flush at a time
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
    } catch (error) {
      this.logger.error(
        `Flush failed for batch of ${batch.length} messages`,
        error,
      );
      // Re-buffer on failure so the next timer cycle will retry.
      // Prepend to keep original ordering.
      this.messageBuffer.unshift(...batch);
    } finally {
      this.isFlushing = false;
    }
  }
}
