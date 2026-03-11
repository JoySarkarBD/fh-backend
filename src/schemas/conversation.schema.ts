/**
 * @fileoverview Conversation MongoDB schema.
 *
 * A Conversation represents a chat thread between two or more participants.
 * It stores a lightweight snapshot of the last message so conversation
 * list screens don't need to join with the messages collection.
 *
 * KEY DESIGN DECISIONS:
 * - participants stores ObjectId refs to the User collection.
 * - property stores an ObjectId ref to the Property the conversation is about.
 * - lastMessage / lastMessageAt are denormalised for efficient list queries.
 * - Socket.IO room IDs are NOT stored here. Rooms are derived at runtime:
 *     room = `conversation:${conversationId}`
 *
 * INDEXES:
 * - { participants: 1 }   → find all conversations a user belongs to
 * - { lastMessageAt: -1 } → sort conversation list by most recent activity
 * - { participants: 1, property: 1 } → unique 1-on-1 lookup per property
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
   * The property this conversation is about.
   * Every conversation is scoped to exactly one property.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Property',
    required: true,
  })
  property!: Types.ObjectId;

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
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

/**
 * Compound index: quickly find conversations containing a specific participant,
 * sorted by most recent activity.
 */
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

/**
 * Compound index: efficiently find a unique 1-on-1 conversation scoped
 * to a specific property (used in createConversation dedup check).
 */
ConversationSchema.index({ participants: 1, property: 1 });
