/**
 * @fileoverview Conversation MongoDB schema.
 *
 * A Conversation represents a chat thread between two or more participants.
 * It stores a lightweight snapshot of the last message so conversation
 * list screens don't need to join with the messages collection.
 *
 * KEY DESIGN DECISIONS:
 * - participants stores ObjectId refs to the User collection.
 * - lastMessage / lastMessageAt are denormalised for efficient list queries.
 * - Socket.IO room IDs are NOT stored here. Rooms are derived at runtime:
 *     room = `conversation:${conversationId}`
 *
 * INDEXES:
 * - { participants: 1 }   → find all conversations a user belongs to
 * - { lastMessageAt: -1 } → sort conversation list by most recent activity
 */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/** Mongoose hydrated document type for Conversation. */
export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true, versionKey: false })
export class Conversation {
  /**
   * Array of User ObjectIds who are members of this conversation.
   * For a 1-on-1 chat this always has exactly 2 entries.
   * For group chat it can have more.
   */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }],
    required: true,
    index: true, // indexed for fast participant lookup
  })
  participants!: Types.ObjectId[];

  /**
   * Denormalised snapshot of the last message text.
   * Updated every time a new message is flushed to MongoDB.
   * Avoids expensive lookups when rendering conversation lists.
   */
  @Prop({ default: '' })
  lastMessage!: string;

  /**
   * Timestamp of the most recent message.
   * Used to sort conversation lists (newest-first).
   */
  @Prop({ type: Date, default: null, index: true })
  lastMessageAt!: Date | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Property',
    default: null,
    index: true,
  })
  propertyId?: Types.ObjectId | null;

  @Prop({
    type: String,
    default: null,
    unique: true,
    sparse: true,
    index: true,
  })
  directKey?: string | null;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

/**
 * Compound index: quickly find conversations containing a specific participant,
 * sorted by most recent activity.
 */
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });
