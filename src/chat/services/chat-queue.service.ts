import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { config } from 'src/config/app.config';
import { MessagePayload } from '../interfaces/chat.interfaces';
import { ChatService } from '../chat.service';

@Injectable()
export class ChatQueueService {
  private readonly logger = new Logger(ChatQueueService.name);

  constructor(
    @Optional() @Inject('CHAT_SERVICE') private readonly client: ClientProxy | null,
    private readonly chatService: ChatService,
  ) {}

  async enqueueMessage(payload: MessagePayload): Promise<void> {
    if (!config.RABBITMQ_ENABLED || !this.client) {
      await this.chatService.bulkSaveMessages([payload]);
      return;
    }

    try {
      this.client.emit('chat_message', payload);
      this.logger.debug(
        `Enqueued message for conversation: ${payload.conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Queue unavailable for ${payload.conversationId}. Falling back to MongoDB write.`,
        error as Error,
      );
      await this.chatService.bulkSaveMessages([payload]);
    }
  }
}
