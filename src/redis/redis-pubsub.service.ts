/**
 * @fileoverview Redis Pub/Sub service.
 *
 * Provides a thin abstraction over ioredis publish/subscribe for
 * real-time message broadcasting to Socket.IO rooms.
 *
 * WHY Pub/Sub (not Streams) for broadcasting?
 * -------------------------------------------
 * - Pub/Sub messages are fire-and-forget — no persistence in Redis RAM.
 * - Perfect for broadcasting "a new chat message arrived" signals to
 *   connected gateways/socket rooms.
 * - Zero memory growth: unread Pub/Sub messages are dropped when there
 *   are no subscribers — Redis never accumulates them.
 *
 * Channel naming convention:
 *   chat:room:<conversationId>
 */

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_COMMANDS } from './redis.constants';


@Injectable()
export class RedisPubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubService.name);

  constructor(
    /** Publisher client — used by gateway to send messages to channels. */
    @Inject(REDIS_COMMANDS.REDIS_CLIENT) private readonly publisher: Redis,
    /** Subscriber client — dedicated connection required by ioredis. */
    @Inject(REDIS_COMMANDS.REDIS_SUBSCRIBER_CLIENT) private readonly subscriber: Redis,
  ) {}

  /**
   * Publishes a JSON-serialised payload to a conversation's Pub/Sub channel.
   *
   * @param conversationId - MongoDB ObjectId string of the conversation.
   * @param payload        - Arbitrary object; will be JSON-stringified.
   */
  async publishToRoom(conversationId: string, payload: object): Promise<void> {
    const channel = `chat:room:${conversationId}`;
    const message = JSON.stringify(payload);
    const receiverCount = await this.publisher.publish(channel, message);
    this.logger.debug(
      `Published to ${channel} — ${receiverCount} subscriber(s) received`,
    );
  }

  /**
   * Subscribes to a conversation's Pub/Sub channel.
   * Calls `handler` with the parsed payload each time a message arrives.
   *
   * @param conversationId - MongoDB ObjectId string of the conversation.
   * @param handler        - Callback invoked with deserialized payload.
   */
  async subscribeToRoom(
    conversationId: string,
    handler: (payload: unknown) => void,
  ): Promise<void> {
    const channel = `chat:room:${conversationId}`;
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch: string, message: string) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(message));
        } catch {
          this.logger.error(`Failed to parse Pub/Sub message on ${ch}`);
        }
      }
    });
    this.logger.debug(`Subscribed to ${channel}`);
  }

  /**
   * Gracefully closes both Redis connections when the module is destroyed.
   */
  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
    await this.publisher.quit();
    this.logger.log('Redis connections closed gracefully');
  }
}
