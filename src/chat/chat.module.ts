/**
 * @fileoverview Chat feature module.
 *
 * Wires together all chat system components:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │              ChatModule                     │
 *   │                                             │
 *   │  Imports:                                   │
 *   │    MongooseModule  → Conversation, Message  │
 *   │    ClientsModule   → CHAT_SERVICE (RabbitMQ)│
 *   │    JwtModule       → for Gateway JWT verify │
 *   │                                             │
 *   │  Controllers:                               │
 *   │    ChatController      (REST API)           │
 *   │    ChatMessageConsumer (RabbitMQ consumer)  │
 *   │                                             │
 *   │  Providers:                                 │
 *   │    ChatService         (MongoDB ops)        │
 *   │    ChatQueueService    (RMQ producer)       │
 *   │    ChatGateway         (WebSocket)          │
 *   └─────────────────────────────────────────────┘
 *
 * RedisModule is registered as @Global() so it does not need to be
 * imported here explicitly — its providers are available app-wide.
 */

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { JwtModule } from '@nestjs/jwt';
import { config } from 'src/config/app.config';
import { jwtConfig } from 'src/common/jwt.config';

// Schemas
import {
  Conversation,
  ConversationSchema,
} from 'src/schemas/conversation.schema';
import { Message, MessageSchema } from 'src/schemas/message.schema';
import { Property, PropertySchema } from 'src/schemas/property.schema';
import { User, UserSchema } from 'src/schemas/user.schema';

// Controllers
import { ChatController } from './chat.controller';
import { ChatMessageConsumer } from './consumers/chat-message.consumer';

// Providers
import { ChatService } from './chat.service';
import { ChatQueueService } from './services/chat-queue.service';
import { ChatGateway } from './chat.gateway';
import { AwsModule } from 'src/common/aws/aws.module';
import { AttachmentService } from './services/attachment.service';

@Module({
  imports: [
    // ── MongoDB schemas ────────────────────────────────────────────────────
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: User.name, schema: UserSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Property.name, schema: PropertySchema },
    ]),

    // ── RabbitMQ client for the CHAT queue ────────────────────────────────
    // Mirrors the mail module pattern exactly.
    // 'CHAT_SERVICE' token is injected into ChatQueueService.
    ClientsModule.register([
      {
        name: 'CHAT_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [config.RABBITMQ_URL],
          queue: config.RABBITMQ_CHAT_QUEUE,
          // durable: true ensures messages survive RabbitMQ restarts
          queueOptions: { durable: true },
        },
      },
    ]),

    // ── JwtModule for WebSocket gateway token verification ────────────────
    // Uses the same secret as the HTTP JwtStrategy.
    JwtModule.register(jwtConfig),
    AwsModule,
  ],

  controllers: [
    ChatController, // REST API: conversations + message history
    ChatMessageConsumer, // RabbitMQ consumer: batches → MongoDB flush
  ],

  providers: [
    ChatService, // MongoDB operations (bulkSave, getMessages, etc.)
    ChatQueueService, // RabbitMQ producer (wraps ClientProxy.emit)
    ChatGateway, // Socket.IO WebSocket gateway
    AttachmentService, // Service for handling S3 attachments safely
  ],
})
export class ChatModule {}
