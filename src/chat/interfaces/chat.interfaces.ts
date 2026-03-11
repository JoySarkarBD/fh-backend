/**
 * @fileoverview Shared interfaces and types for the Chat module.
 *
 * Centralising types here keeps gateway, service, and consumer in sync
 * without circular dependency issues.
 */

import { Types } from 'mongoose';
import { MessageStatus } from 'src/schemas/message.schema';

export interface AttachmentPayload {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string | Types.ObjectId;
  createdAt: Date | string;
}

/**
 * The raw payload emitted by the WebSocket gateway and pushed onto
 * the RabbitMQ chat queue.  This is what the consumer reads.
 */
export interface MessagePayload {
  /** Generated ObjectId at gateway. */
  _id: string;

  /** MongoDB ObjectId string of the conversation. */
  conversationId: string;

  /** MongoDB ObjectId string of the user sending the message. */
  senderId: string;

  /** Text body of the message. */
  message: string;

  /**
   * Optional list of attachment objects.
   * Already uploaded to S3 by the client before emitting the WS event.
   */
  attachments?: AttachmentPayload[];

  /**
   * ISO-8601 timestamp set by the gateway at the moment the WS event
   * is received. Preserves ordering even after batch insertion.
   */
  createdAt: string;

  /** Initial status is always 'sent'. */
  status: MessageStatus;

  isForwarded?: boolean;
  originalMessageId?: string | null;
  forwardedBy?: string | null;

  isUnsent?: boolean;
  deletedForUsers?: string[];
}

/**
 * Shape of a message document returned to the client via REST API.
 */
export interface MessageResponse {
  _id: string;
  conversationId: string;
  senderId: string;
  message: string;
  attachments: AttachmentPayload[];
  status: MessageStatus;
  isForwarded: boolean;
  originalMessageId: string | null;
  forwardedBy: string | null;
  isUnsent: boolean;
  createdAt: string;
}

/**
 * Response envelope for the paginated message history endpoint.
 *
 * Contract:
 *   - `messages` contains ≤ `limit` items, ordered newest-first.
 *   - `nextCursor` is the `createdAt` of the oldest message in this page.
 *     Pass it as the `cursor` query param to fetch the next (older) page.
 *   - `nextCursor` is `null` when there are no more older messages.
 */
export interface PaginatedMessages {
  messages: MessageResponse[];
  /** ISO-8601 timestamp to use as `cursor` in the next request. */
  nextCursor: string | null;
  /** Total count returned in this page. */
  count: number;
}

/**
 * Data object stored in socket.data after successful JWT verification
 * on WebSocket handshake.
 */
export interface SocketUser {
  userId: string;
  email: string;
  role?: string;
}

/**
 * Payload for the MongoDB bulk save.
 * Maps MessagePayload to the Message schema shape.
 */
export interface MessageDocument {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  message: string;
  attachments: AttachmentPayload[];
  status: MessageStatus;
  isForwarded: boolean;
  originalMessageId: Types.ObjectId | null;
  forwardedBy: Types.ObjectId | null;
  isUnsent: boolean;
  deletedForUsers: Types.ObjectId[];
  createdAt: Date;
}
