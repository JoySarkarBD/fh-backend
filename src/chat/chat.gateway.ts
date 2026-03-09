import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { SocketUser } from './interfaces/chat.interfaces';

interface AuthenticatedSocket extends Socket {
  data: {
    user: SocketUser;
  };
}

@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      socket.emit('error', { message: 'Authentication token required' });
      socket.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<SocketUser & { sub: string }>(
        token,
        { secret: process.env.JWT_SECRET as string },
      );

      socket.data.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      await socket.join(`user:${payload.sub}`);

      await this.chatService.setUserPresence(payload.sub, true);
      this.server.emit('presenceUpdated', {
        userId: payload.sub,
        isOnline: true,
        lastActiveAt: null,
      });

      this.logger.log(`[${socket.id}] Connected user ${payload.sub}`);
    } catch {
      socket.emit('error', { message: 'Invalid or expired token' });
      socket.disconnect();
    }
  }

  handleDisconnect(socket: AuthenticatedSocket): void {
    const userId = socket.data?.user?.userId;
    if (!userId) {
      return;
    }

    void this.chatService.setUserPresence(userId, false);
    this.server.emit('presenceUpdated', {
      userId,
      isOnline: false,
      lastActiveAt: new Date().toISOString(),
    });

    this.logger.log(`[${socket.id}] Disconnected user ${userId}`);
  }

  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      await this.chatService.validateParticipant(data.conversationId, userId);
      const roomName = `conversation:${data.conversationId}`;
      await socket.join(roomName);
      socket.emit('joinedRoom', {
        conversationId: data.conversationId,
        room: roomName,
      });
    } catch (error) {
      socket.emit('error', {
        message: error instanceof Error ? error.message : 'Join failed',
      });
    }
  }

  @SubscribeMessage('sendMessage')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => errors,
    }),
  )
  async handleSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() dto: SendMessageDto,
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      const message = await this.chatService.createMessage(dto, userId);
      this.server
        .to(`conversation:${dto.conversationId}`)
        .emit('messageReceived', message);
      await this.emitConversationUpdates(dto.conversationId);
    } catch (error) {
      socket.emit('error', {
        message: error instanceof Error ? error.message : 'Failed to send message',
      });
    }
  }

  @SubscribeMessage('unsendMessage')
  async handleUnsendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      const result = await this.chatService.unsendMessage(data.messageId, userId);
      if (result.message) {
        this.server
          .to(`conversation:${result.conversationId}`)
          .emit('messageUpdated', result.message);
      }
      await this.emitConversationUpdates(result.conversationId);
    } catch (error) {
      socket.emit('error', {
        message: error instanceof Error ? error.message : 'Failed to unsend message',
      });
    }
  }

  @SubscribeMessage('deleteForMe')
  async handleDeleteForMe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      const result = await this.chatService.deleteMessageForMe(data.messageId, userId);
      this.server.to(`user:${userId}`).emit('messageDeletedForUser', result);
      await this.emitConversationUpdates(result.conversationId);
    } catch (error) {
      socket.emit('error', {
        message:
          error instanceof Error ? error.message : 'Failed to delete message',
      });
    }
  }

  @SubscribeMessage('forwardMessage')
  async handleForwardMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; targetConversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      const message = await this.chatService.forwardMessage(
        data.messageId,
        { targetConversationId: data.targetConversationId },
        userId,
      );

      this.server
        .to(`conversation:${data.targetConversationId}`)
        .emit('messageReceived', message);

      await this.emitConversationUpdates(data.targetConversationId);
    } catch (error) {
      socket.emit('error', {
        message: error instanceof Error ? error.message : 'Failed to forward',
      });
    }
  }

  @SubscribeMessage('markSeen')
  async handleMarkSeen(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      await this.chatService.markConversationSeen(data.conversationId, userId);
      this.server.to(`conversation:${data.conversationId}`).emit('markedSeen', {
        conversationId: data.conversationId,
        seenBy: userId,
        seenAt: new Date().toISOString(),
      });
      await this.emitConversationUpdates(data.conversationId);
    } catch (error) {
      socket.emit('error', {
        message: error instanceof Error ? error.message : 'Failed to mark seen',
      });
    }
  }

  private async emitConversationUpdates(conversationId: string): Promise<void> {
    const participantIds =
      await this.chatService.getConversationParticipantIds(conversationId);

    await Promise.all(
      participantIds.map(async (participantId) => {
        const conversation = await this.chatService.getConversationByIdForUser(
          conversationId,
          participantId,
        );

        if (!conversation) return;

        this.server.to(`user:${participantId}`).emit('conversationUpdated', {
          conversation,
          userId: participantId,
        });
      }),
    );
  }
}
