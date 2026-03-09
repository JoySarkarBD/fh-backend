/**
 * @fileoverview WebSocket Gateway for the real-time chat system.
 *
 * Handles all Socket.IO connections under the `/chat` namespace.
 *
 * ─── AUTHENTICATION ───────────────────────────────────────────────────────────
 * JWT is validated on EVERY connection attempt in handleConnection().
 * Clients must pass their token in the Socket.IO handshake:
 *
 *   const socket = io('http://localhost:5000/chat', {
 *     auth: { token: '<JWT>' }
 *   });
 *
 * ─── ROOM NAMING ─────────────────────────────────────────────────────────────
 * Socket.IO rooms are named `conversation:<conversationId>`.
 * The conversationId is a MongoDB ObjectId — it IS persisted to DB.
 * The room name itself is NEVER stored — it is always derived at runtime.
 *
 * ─── MESSAGE FLOW ────────────────────────────────────────────────────────────
 *
 *   Client emits 'sendMessage' with { conversationId, message, attachments? }
 *     │
 *     ├─ 1. Validate JWT (already done on connection)
 *     ├─ 2. Verify user is a participant of the conversation
 *     ├─ 3. Enqueue to RabbitMQ via ChatQueueService (async, returns fast)
 *     └─ 4. Broadcast 'messageReceived' to all sockets in the room (optimistic)
 *
 * Persistence happens asynchronously in ChatMessageConsumer — the client
 * sees the message immediately without waiting for MongoDB.
 *
 * ─── EVENTS EMITTED BY SERVER ────────────────────────────────────────────────
 *
 *   messageReceived  → new message broadcast to room members
 *   error            → sent to the emitting socket on validation failure
 *   joinedRoom       → confirmation after socket joins a conversation room
 *   markedSeen       → broadcast to room when a user marks messages as seen
 */

import { Logger, UsePipes, ValidationPipe, Inject } from '@nestjs/common';
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
import { MessageStatus } from 'src/schemas/message.schema';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagePayload, SocketUser } from './interfaces/chat.interfaces';
import { ChatQueueService } from './services/chat-queue.service';
import { REDIS_COMMANDS } from 'src/redis/redis.constants';
import Redis from 'ioredis';

import { Types } from 'mongoose';

/**
 * Extend the Socket type to carry authenticated user data after handshake.
 */
interface AuthenticatedSocket extends Socket {
  data: {
    user: SocketUser;
  };
}

@WebSocketGateway({
  namespace: 'chat', // ws://host:port/chat
  cors: {
    origin: '*', // Adjust to FRONTEND_BASE_URL in production
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** The underlying Socket.IO server instance. */
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatQueueService: ChatQueueService,
    private readonly jwtService: JwtService,
    @Inject(REDIS_COMMANDS.REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CONNECTION LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Called by Socket.IO immediately after a client connects.
   *
   * Validates the JWT from the handshake. If invalid, the socket is
   * disconnected before any events can be processed.
   */
  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn(
        `[${socket.id}] Connection rejected — no token provided`,
      );
      socket.emit('error', { message: 'Authentication token required' });
      socket.disconnect();
      return;
    }

    try {
      // Verify the JWT using the same secret as the HTTP guards
      const payload = this.jwtService.verify<SocketUser & { sub: string }>(
        token,
        { secret: process.env.JWT_SECRET as string },
      );

      // Attach the verified user data to the socket for use in event handlers
      socket.data.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      this.logger.log(
        `[${socket.id}] Connected — user: ${payload.email} (${payload.sub})`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[${socket.id}] Connection rejected — invalid token: ${errorMessage}`,
      );
      socket.emit('error', { message: 'Invalid or expired token' });
      socket.disconnect();
    }
  }

  /**
   * Called when a client disconnects (browser closed, network lost, etc.).
   * Socket.IO automatically removes the socket from all rooms it joined, so
   * no manual cleanup is needed.
   */
  handleDisconnect(socket: AuthenticatedSocket): void {
    const userId = socket.data?.user?.userId ?? 'unknown';
    this.logger.log(`[${socket.id}] Disconnected — user: ${userId}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SOCKET EVENTS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * CLIENT → SERVER: 'joinConversation'
   *
   * Joins the socket into the Socket.IO room for a conversation so it
   * receives all future 'messageReceived' broadcasts for that conversation.
   *
   * The client calls this event after opening the chat screen.
   *
   * Payload: { conversationId: string }
   * Server emits: 'joinedRoom' back to the same socket.
   */
  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    try {
      // Validate the user is a participant of this conversation
      await this.chatService.validateParticipant(data.conversationId, userId);

      // Join the Socket.IO room (idempotent — safe to call multiple times)
      const roomName = `conversation:${data.conversationId}`;
      await socket.join(roomName);

      this.logger.debug(
        `[${socket.id}] User ${userId} joined room: ${roomName}`,
      );

      // Confirm to the client that join was successful
      socket.emit('joinedRoom', {
        conversationId: data.conversationId,
        room: roomName,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `[${socket.id}] joinConversation failed for user ${userId}: ${errorMessage}`,
      );
      socket.emit('error', { message: errorMessage });
    }
  }

  /**
   * CLIENT → SERVER: 'sendMessage'
   *
   * Main message sending event.  Receives a message payload, validates it,
   * enqueues it to RabbitMQ for async MongoDB persistence, and immediately
   * broadcasts it to all room members for real-time delivery.
   *
   * Payload: SendMessageDto { conversationId, message, attachments? }
   * Server emits: 'messageReceived' to all sockets in the conversation room.
   */
  @SubscribeMessage('sendMessage')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Emit 'error' event instead of throwing HTTP exception
      exceptionFactory: (errors) => errors,
    }),
  )
  async handleSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() dto: SendMessageDto,
  ): Promise<void> {
    const { userId } = socket.data.user;

    // Validate user is a participant of the conversation
    // (prevents spoofed conversationIds)
    try {
      await this.chatService.validateParticipant(dto.conversationId, userId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      socket.emit('error', { message: errorMessage });
      return;
    }

    // Build the message payload with a precise timestamp and generated ID
    const payload: MessagePayload = {
      _id: new Types.ObjectId().toString(),
      conversationId: dto.conversationId,
      senderId: userId,
      message: dto.message,
      attachments: dto.attachments ?? [],
      isForwarded: dto.isForwarded,
      originalMessageId: dto.originalMessageId,
      forwardedBy: dto.forwardedBy,
      createdAt: new Date().toISOString(), // Gateway timestamp — preserves order
      status: MessageStatus.SENT,
    };

    // ① Enqueue to RabbitMQ (non-blocking) — consumer will batch → MongoDB
    await this.chatQueueService.enqueueMessage(payload);

    // ② Optimistic broadcast: push to all room members immediately
    //    so they don't wait 30 seconds for MongoDB persistence.
    const roomName = `conversation:${dto.conversationId}`;
    this.server.to(roomName).emit('messageReceived', payload);

    this.logger.debug(
      `Message from user ${userId} enqueued and broadcast to room ${roomName}`,
    );
  }

  /**
   * CLIENT → SERVER: 'markSeen'
   *
   * Allows a recipient to mark all messages in a conversation as 'seen'.
   * Broadcasts a 'markedSeen' event to the room so the sender's UI
   * can update the read receipt indicator.
   *
   * NOTE: Actual status update in MongoDB is done here directly (single write,
   * not a batch operation) since seen-status updates are infrequent.
   *
   * Payload: { conversationId: string }
   */
  @SubscribeMessage('markSeen')
  async handleMarkSeen(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;

    try {
      // Validate participation
      await this.chatService.validateParticipant(data.conversationId, userId);

      // Broadcast seen status to the conversation room
      // (the actual DB update can be done via REST if needed)
      this.server.to(roomName).emit('markedSeen', {
        conversationId: data.conversationId,
        seenBy: userId,
        seenAt: new Date().toISOString(),
      });

      this.logger.debug(
        `User ${userId} marked conversation ${data.conversationId} as seen`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      socket.emit('error', { message: errorMessage });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // NEW FEATURES: FORWARD, UNSEND, DELETE, ATTACHMENTS, TYPING
  // ─────────────────────────────────────────────────────────────────────────────

  @SubscribeMessage('typingStart')
  async handleTypingStart(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;
    
    // Set in Redis with 5 second TTL
    await this.redis.set(`chat:typing:${data.conversationId}:${userId}`, '1', 'EX', 5);
    
    // Broadcast to room (exclude sender ideally, but keeping it simple)
    socket.to(roomName).emit('typingStart', { conversationId: data.conversationId, userId });
  }

  @SubscribeMessage('typingStop')
  async handleTypingStop(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;
    
    await this.redis.del(`chat:typing:${data.conversationId}:${userId}`);
    socket.to(roomName).emit('typingStop', { conversationId: data.conversationId, userId });
  }

  @SubscribeMessage('unsendMessage')
  async handleUnsendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string, messageId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;

    await this.chatQueueService.enqueueMessageUnsent({
      conversationId: data.conversationId,
      messageId: data.messageId,
      userId,
    });

    // Optimistic broadcast
    this.server.to(roomName).emit('messageUnsent', {
      conversationId: data.conversationId,
      messageId: data.messageId,
      userId,
    });
  }

  @SubscribeMessage('deleteForMe')
  async handleDeleteForMe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string, messageId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    
    await this.chatQueueService.enqueueMessageDeletedForMe({
      conversationId: data.conversationId,
      messageId: data.messageId,
      userId,
    });

    // Send confirmation back to the individual socket only
    socket.emit('messageDeletedForMe', {
      conversationId: data.conversationId,
      messageId: data.messageId,
    });
  }

  @SubscribeMessage('removeAttachment')
  async handleRemoveAttachment(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string, messageId: string, attachmentKey: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;

    await this.chatQueueService.enqueueAttachmentDeleted({
      conversationId: data.conversationId,
      messageId: data.messageId,
      attachmentKey: data.attachmentKey,
      userId,
    });

    // Optimistic broadcast
    this.server.to(roomName).emit('attachmentRemoved', {
      conversationId: data.conversationId,
      messageId: data.messageId,
      attachmentKey: data.attachmentKey,
    });
  }
}
