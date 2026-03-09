import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { JwtModule } from '@nestjs/jwt';
import { config } from 'src/config/app.config';
import { jwtConfig } from 'src/common/jwt.config';
import { AwsModule } from 'src/common/aws/aws.module';

import { Conversation, ConversationSchema } from 'src/schemas/conversation.schema';
import { Message, MessageSchema } from 'src/schemas/message.schema';
import { User, UserSchema } from 'src/schemas/user.schema';
import { Property, PropertySchema } from 'src/schemas/property.schema';

import { ChatController } from './chat.controller';
import { ChatMessageConsumer } from './consumers/chat-message.consumer';
import { ChatService } from './chat.service';
import { ChatQueueService } from './services/chat-queue.service';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [
    AwsModule,
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: User.name, schema: UserSchema },
      { name: Property.name, schema: PropertySchema },
    ]),
    ...(config.RABBITMQ_ENABLED
      ? [
          ClientsModule.register([
            {
              name: 'CHAT_SERVICE',
              transport: Transport.RMQ,
              options: {
                urls: [config.RABBITMQ_URL],
                queue: config.RABBITMQ_CHAT_QUEUE,
                queueOptions: { durable: true },
              },
            },
          ]),
        ]
      : []),
    JwtModule.register(jwtConfig),
  ],
  controllers: [ChatController, ChatMessageConsumer],
  providers: [ChatService, ChatQueueService, ChatGateway],
})
export class ChatModule {}
