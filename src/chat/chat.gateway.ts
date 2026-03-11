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
 * ─── RATE LIMITING ───────────────────────────────────────────────────────────
 * Each user is allowed at most RATE_LIMIT_MAX messages per RATE_LIMIT_WINDOW_MS.
 * A Redis sorted set `chat:ratelimit:<userId>` is used as a sliding window.
 * Excess events are silently dropped with an 'error' event sent to the client.
 *
 * ─── MESSAGE FLOW ────────────────────────────────────────────────────────────
 *
 *   Client emits 'sendMessage' with { conversationId, message, attachments? }
 *     │
 *     ├─ 1. Validate JWT (already done on connection)
 *     ├─ 2. Rate limit check via Redis sliding window
 *     ├─ 3. Sanitize message text (strip HTML/XSS)
 *     ├─ 4. Verify user is a participant of the conversation
 *     ├─ 5. Enqueue to RabbitMQ via ChatQueueService (async, returns fast)
 *     └─ 6. Broadcast 'messageReceived' to all sockets in the room (optimistic)
 *
 * ─── EVENTS EMITTED BY SERVER ────────────────────────────────────────────────
 *
 *   messageReceived  → new message broadcast to room members
 *   messageUnsent    → message unsent broadcast to room members
 *   messageDeletedForMe → sent only to the requesting socket
 *   error            → sent to the emitting socket on validation/rate-limit failure
 *   joinedRoom       → confirmation after socket joins a conversation room
 *   markedSeen       → broadcast to room when a user marks messages as seen
 *   presenceUpdated  → broadcast to room when user connects/disconnects
 *   typingStarted    → broadcast to room (excluding sender)
 *   typingStopped    → broadcast to room (excluding sender)
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
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sanitizeHtml = require('sanitize-html') as typeof import('sanitize-html');
import { MessageStatus } from 'src/schemas/message.schema';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagePayload, SocketUser } from './interfaces/chat.interfaces';
// eslint-disable-next-line @typescript-eslint/no-require-imports

import { Types } from 'mongoose';
import { ChatQueueService } from './services/chat-queue.service';
import { REDIS_COMMANDS } from 'src/redis/redis.constants';

/**
 * Extend the Socket type to carry authenticated user data after handshake.
 */
interface AuthenticatedSocket extends Socket {
  data: {
    user: SocketUser;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Max events allowed per user within the sliding window. */
const RATE_LIMIT_MAX = 20;

/** Sliding window duration in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds

@WebSocketGateway({
  namespace: 'chat', // ws://host:port/chat
  cors: {
    origin: process.env.FRONTEND_BASE_URL ?? '*',
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
   * Also registers the socket in Redis for accurate online-presence tracking.
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

      // ── Redis Presence Tracking ──────────────────────────────────────────
      // Track this socket under the user's set of active sockets.
      // This allows us to detect disconnection accurately across multiple tabs.
      const { userId } = socket.data.user;
      await this.redis.sadd(`chat:sockets:${userId}`, socket.id);
      await this.redis.set(`chat:presence:${userId}`, '1', 'EX', 86400); // 24h TTL

      // Broadcast to ALL rooms this user is in that they are now online
      this.server.emit('presenceUpdated', {
        userId,
        isOnline: true,
        lastActiveAt: null,
      });

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
   * Cleans up Redis presence state and broadcasts offline status.
   */
  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const userId = socket.data?.user?.userId ?? 'unknown';

    if (userId !== 'unknown') {
      // Remove this specific socket from the user's active socket set
      await this.redis.srem(`chat:sockets:${userId}`, socket.id);

      // Check if the user has any remaining active sockets
      const remainingSockets = await this.redis.scard(`chat:sockets:${userId}`);

      if (remainingSockets === 0) {
        // User is fully offline — update presence and notify room
        const lastActiveAt = new Date().toISOString();
        await this.redis.set(
          `chat:lastActive:${userId}`,
          lastActiveAt,
          'EX',
          86400,
        );
        await this.redis.del(`chat:presence:${userId}`);

        this.server.emit('presenceUpdated', {
          userId,
          isOnline: false,
          lastActiveAt,
        });

        this.logger.log(
          `[${socket.id}] Disconnected — user ${userId} is now offline`,
        );
      } else {
        this.logger.log(
          `[${socket.id}] Disconnected — user ${userId} still has ${remainingSockets} active socket(s)`,
        );
      }
    } else {
      this.logger.log(`[${socket.id}] Disconnected — unauthenticated socket`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Checks if a user has exceeded the message rate limit using a Redis
   * sorted set as a sliding window log.
   *
   * @returns `true` if the user is rate-limited (should be rejected), `false` if OK.
   */
  private async isRateLimited(userId: string): Promise<boolean> {
    const key = `chat:ratelimit:${userId}`;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    const pipeline = this.redis.pipeline();
    // Remove timestamps older than the window
    pipeline.zremrangebyscore(key, '-inf', windowStart);
    // Add current timestamp as the event score
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    // Count events in the window
    pipeline.zcard(key);
    // Keep the key alive for at least the window duration
    pipeline.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));

    const results = await pipeline.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;

    return count > RATE_LIMIT_MAX;
  }

  /**
   * Strips all HTML tags from a message string to prevent XSS injection
   * when the message is stored and broadcast to other clients.
   */
  private sanitizeMessage(message: string): string {
    return sanitizeHtml(message, {
      allowedTags: [], // No HTML allowed
      allowedAttributes: {}, // No attributes allowed
    }).trim();
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
   * sanitizes the text, enforces rate limits, enqueues it to RabbitMQ for
   * async MongoDB persistence, and immediately broadcasts it to all room
   * members for real-time delivery.
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

    // ── Rate Limit Check ────────────────────────────────────────────────────
    if (await this.isRateLimited(userId)) {
      this.logger.warn(`[${socket.id}] Rate limit exceeded for user ${userId}`);
      socket.emit('error', {
        message: 'You are sending messages too fast. Please slow down.',
      });
      return;
    }

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

    // ── XSS Sanitization ────────────────────────────────────────────────────
    const cleanMessage = dto.message ? this.sanitizeMessage(dto.message) : '';

    if (!cleanMessage && (!dto.attachments || dto.attachments.length === 0)) {
      socket.emit('error', { message: 'Message cannot be empty.' });
      return;
    }

    // Build the message payload with a precise timestamp and generated ID
    const payload: MessagePayload = {
      _id: new Types.ObjectId().toString(),
      conversationId: dto.conversationId,
      senderId: userId,
      message: cleanMessage,
      attachments: dto.attachments ?? [],
      isForwarded: dto.isForwarded,
      originalMessageId: dto.originalMessageId,
      forwardedBy: dto.forwardedBy,
      createdAt: new Date().toISOString(), // Gateway timestamp — preserves order
      status: MessageStatus.SENT,
    };

    // ① Enqueue to RabbitMQ (non-blocking) — consumer will batch → MongoDB
    await this.chatQueueService.enqueueMessage(payload);

    // ② Write to Redis immediately so REST GET /chat/messages can see this
    //    message before the 30-second MongoDB flush fires.
    //
    //    Layout:
    //      chat:buf:{conversationId}  → sorted set  (score = epoch ms, member = messageId)
    //      chat:msg:{messageId}       → string       (JSON of full payload)
    //
    //    Both keys have a 90-second TTL — slightly longer than the 30-second
    //    flush interval — so they self-clean even if the consumer cleanup fails.
    const bufKey = `chat:buf:${dto.conversationId}`;
    const msgKey = `chat:msg:${payload._id}`;
    const score = new Date(payload.createdAt).getTime();
    await this.redis
      .pipeline()
      .zadd(bufKey, score, payload._id)
      .set(msgKey, JSON.stringify(payload), 'EX', 90)
      .expire(bufKey, 90)
      .exec();

    // ③ Optimistic broadcast: push to all room members immediately
    //    so they don't wait 30 seconds for MongoDB persistence.
    const roomName = `conversation:${dto.conversationId}`;
    this.server.to(roomName).emit('messageReceived', payload);

    this.logger.debug(
      `Message from user ${userId} enqueued, Redis-buffered, and broadcast to room ${roomName}`,
    );
  }

  /**
   * CLIENT → SERVER: 'markSeen'
   *
   * Allows a recipient to mark all messages in a conversation as 'seen'.
   * Broadcasts a 'markedSeen' event to the room so the sender's UI
   * can update the read receipt indicator.
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
  // FEATURES: TYPING, UNSEND, DELETE, FORWARD
  // ─────────────────────────────────────────────────────────────────────────────

  @SubscribeMessage('typingStarted')
  async handleTypingStarted(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;

    // Store typing state in Redis with 5-second TTL (auto-expires if client crashes)
    await this.redis.set(
      `chat:typing:${data.conversationId}:${userId}`,
      '1',
      'EX',
      5,
    );

    // Broadcast to room (excluded sender via socket.to())
    socket.to(roomName).emit('typingStarted', {
      conversationId: data.conversationId,
      userId,
    });
  }

  @SubscribeMessage('typingStopped')
  async handleTypingStopped(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;

    await this.redis.del(`chat:typing:${data.conversationId}:${userId}`);
    socket.to(roomName).emit('typingStopped', {
      conversationId: data.conversationId,
      userId,
    });
  }

  @SubscribeMessage('unsendMessage')
  async handleUnsendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; messageId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;
    const roomName = `conversation:${data.conversationId}`;

    await this.chatQueueService.enqueueMessageUnsent({
      conversationId: data.conversationId,
      messageId: data.messageId,
      userId,
    });

    // Optimistic broadcast — all room members see the unsent state immediately
    this.server.to(roomName).emit('messageUnsent', {
      conversationId: data.conversationId,
      messageId: data.messageId,
      userId,
    });
  }

  @SubscribeMessage('deleteForMe')
  async handleDeleteForMe(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string; messageId: string },
  ): Promise<void> {
    const { userId } = socket.data.user;

    await this.chatQueueService.enqueueMessageDeletedForMe({
      conversationId: data.conversationId,
      messageId: data.messageId,
      userId,
    });

    // Send confirmation back ONLY to the requesting socket (private delete)
    socket.emit('messageDeletedForMe', {
      conversationId: data.conversationId,
      messageId: data.messageId,
    });
  }

  @SubscribeMessage('removeAttachment')
  async handleRemoveAttachment(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody()
    data: {
      conversationId: string;
      messageId: string;
      attachmentKey: string;
    },
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
