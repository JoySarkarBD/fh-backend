/**
 * @fileoverview Global Redis module.
 *
 * Provides two ioredis client instances as injectable tokens:
 *
 *  - `REDIS_CLIENT`            → used for publishing Pub/Sub messages.
 *  - `REDIS_SUBSCRIBER_CLIENT` → dedicated subscriber connection.
 *    (ioredis requires a separate client once subscribe() is called)
 *
 * Declared as `@Global()` so any module can inject the clients
 * without re-importing `RedisModule`.
 */

import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from 'src/config/app.config';
import { RedisPubSubService } from './redis-pubsub.service';
import { REDIS_COMMANDS } from './redis.constants';

const logger = new Logger('RedisModule');

/**
 * Factory that creates an ioredis client connected to REDIS_URL.
 * Logs connection events so issues are visible in server logs.
 */
function createRedisClient(name: string): Redis {
  const client = new Redis(config.REDIS_URL, {
    // Reconnect automatically with exponential back-off (max 3s)
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    lazyConnect: false,
    enableReadyCheck: true,
  });

  client.on('connect', () => logger.log(`[${name}] Connected to Redis`));
  client.on('ready', () => logger.log(`[${name}] Redis client ready`));
  client.on('error', (err) => logger.error(`[${name}] Redis error`, err));
  client.on('reconnecting', () =>
    logger.warn(`[${name}] Redis reconnecting...`),
  );

  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_COMMANDS.REDIS_CLIENT,
      useFactory: () => createRedisClient('Publisher'),
    },
    {
      provide: REDIS_COMMANDS.REDIS_SUBSCRIBER_CLIENT,
      useFactory: () => createRedisClient('Subscriber'),
    },
    RedisPubSubService,
  ],
  exports: [REDIS_COMMANDS.REDIS_CLIENT, REDIS_COMMANDS.REDIS_SUBSCRIBER_CLIENT, RedisPubSubService],
})
export class RedisModule {}
