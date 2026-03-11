/**
 * @fileoverview Message MongoDB schema.
 *
 * Represents a single chat message inside a Conversation.
 * Messages are written in bulk batches by the MessageWorker consumer,
 * NOT one-by-one, for performance.
 *
 * KEY DESIGN DECISIONS:
 * - conversationId references the Conversation document (not the socket room).
 * - senderId references the User who authored the message.
 * - attachments is an optional array of S3/CDN URLs for file/image uploads.
 * - status tracks delivery state: 'sent' → 'delivered' → 'seen'.
 * - createdAt is managed manually (not via Mongoose timestamps) so we can
 *   set an exact timestamp at the moment the WebSocket message is received,
 *   before batching.  This ensures correct order after bulk insert.
 *
 * INDEXES:
 * - { conversationId: 1, createdAt: -1 } (compound) → enables fast cursor
 *   pagination for chat history (scrolling up).
 * - { senderId: 1 }                                  → optional; useful for
 *   "messages by this user" queries.
 */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class Attachment {
  @Prop({ required: true })
  key!: string;

  @Prop({ required: true })
  url!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  createdAt!: Date;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

/** Mongoose hydrated document type for Message. */
export type MessageDocument = HydratedDocument<Message>;

/** Delivery status lifecycle of a chat message. */
export enum MessageStatus {
  /** Message received by the server and queued. */
  SENT = 'sent',
  /** Message delivered to the recipient's device. */
  DELIVERED = 'delivered',
  /** Recipient has read/seen the message. */
  SEEN = 'seen',
}

@Schema({ versionKey: false })
export class Message {
  /**
   * References the Conversation this message belongs to.
   * We use this (not a socket room ID) so messages survive socket reconnects.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId!: Types.ObjectId;

  /**
   * References the User who sent this message.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  senderId!: Types.ObjectId;

  /**
   * The text body of the message.
   * Empty string is allowed when the message is attachment-only.
   */
  @Prop({ required: true, trim: true, default: '' })
  message!: string;

  /**
   * Optional array of attachments (images, files).
   */
  @Prop({ type: [AttachmentSchema], default: [] })
  attachments!: Attachment[];

  /**
   * Delivery status of the message.
   * Starts at 'sent' when saved and progresses via WebSocket events.
   */
  @Prop({ enum: MessageStatus, default: MessageStatus.SENT })
  status!: MessageStatus;

  /** Indicates if the message was forwarded from another conversation. */
  @Prop({ default: false })
  isForwarded!: boolean;

  /** Reference to the original message if forwarded. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Message', default: null })
  originalMessageId!: Types.ObjectId | null;

  /** Reference to the user who forwarded the message. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  forwardedBy!: Types.ObjectId | null;

  /** Indicates if the sender unsent this message. */
  @Prop({ default: false })
  isUnsent!: boolean;

  /** Array of user IDs who have deleted this message for themselves. */
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }], default: [] })
  deletedForUsers!: Types.ObjectId[];

  /**
   * Exact timestamp when the WebSocket gateway received the message.
   * Set by the gateway (not by MongoDB) to preserve insertion order
   * after bulk batching.
   */
  @Prop({ type: Date, required: true })
  createdAt!: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

/**
 * Compound index: primary access pattern for cursor-paginated chat history.
 * Fetches messages for a conversation, sorted newest-first, filtered by cursor.
 */
MessageSchema.index({ conversationId: 1, createdAt: -1 });
