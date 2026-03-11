/**
 * @fileoverview RabbitMQ producer for the chat message queue.
 *
 * Mirrors the pattern used in MailService: injects the `CHAT_SERVICE`
 * ClientProxy and uses `.emit()` to push messages onto the
 * `chat_message_queue` RabbitMQ queue.
 *
 * FLOW:
 *   ChatGateway (WebSocket) calls enqueueMessage()
 *     → ClientProxy.emit('chat_message', payload)
 *       → RabbitMQ 'chat_message_queue'
 *         → ChatMessageConsumer (@EventPattern) reads & batches
 *           → MongoDB insertMany() on flush
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MessagePayload } from '../interfaces/chat.interfaces';

@Injectable()
export class ChatQueueService {
  private readonly logger = new Logger(ChatQueueService.name);

  constructor(
    /**
     * Injected RabbitMQ proxy registered under the token 'CHAT_SERVICE'.
     * Configured in ChatModule.imports with Transport.RMQ.
     */
    @Inject('CHAT_SERVICE') private readonly client: ClientProxy,
  ) {}

  /**
   * Pushes a single message payload onto the RabbitMQ chat queue.
   *
   * This is a fire-and-forget emit (not RPC), so it returns immediately.
   * RabbitMQ guarantees delivery to the consumer as long as the queue
   * is durable and the broker is running.
   *
   * @param payload - Complete message data including conversationId,
   *                  senderId, message text, attachments, and timestamp.
   */
  async enqueueMessage(payload: MessagePayload): Promise<void> {
    try {
      // emit() is non-blocking. The ClientProxy serialises the payload
      // to JSON and hands it to the AMQP channel.
      this.client.emit('chat_message', payload);
      this.logger.debug(
        `Enqueued message for conversation: ${payload.conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue message for conversation ${payload.conversationId}`,
        error,
      );
      // Do not re-throw — the WebSocket response is already sent to the client.
      // The message will be lost in this edge case (broker down), but the
      // client received optimistic confirmation. This trade-off is acceptable
      // for a chat system.  For zero-loss, use a local fallback queue here.
    }
  }

  async enqueueMessageUnsent(payload: { messageId: string, conversationId: string, userId: string }): Promise<void> {
    try {
      this.client.emit('message_unsent', payload);
    } catch (e) {
      this.logger.error(`Failed to enqueue unsend for message ${payload.messageId}`, e);
    }
  }

  async enqueueMessageDeletedForMe(payload: { messageId: string, conversationId: string, userId: string }): Promise<void> {
    try {
      this.client.emit('message_deleted_for_me', payload);
    } catch (e) {
      this.logger.error(`Failed to enqueue deleteForMe for message ${payload.messageId}`, e);
    }
  }

  async enqueueAttachmentDeleted(payload: { messageId: string, conversationId: string, attachmentKey: string, userId: string }): Promise<void> {
    try {
      this.client.emit('attachment_deleted', payload);
    } catch (e) {
      this.logger.error(`Failed to enqueue attachment delete for message ${payload.messageId}`, e);
    }
  }
}
