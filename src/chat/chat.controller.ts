/**
 * @fileoverview Chat REST API controller.
 *
 * Provides HTTP endpoints for:
 *   1. Creating conversations                (POST /api/chat/conversations)
 *   2. Listing user's conversations          (GET  /api/chat/conversations)
 *   3. Fetching cursor-paginated messages    (GET  /api/chat/messages)
 *
 * All endpoints require a valid JWT (JwtAuthGuard).
 *
 * CURSOR PAGINATION USAGE:
 *   First request  → GET /api/chat/messages?conversationId=xxx&limit=20
 *   Next page      → GET /api/chat/messages?conversationId=xxx&cursor=<nextCursor>&limit=20
 *
 * `nextCursor` is the `createdAt` ISO string of the OLDEST message on the
 * previous page.  Pass it on subsequent requests to load older messages.
 * Returns `nextCursor: null` when there are no more older messages.
 */

import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetMessagesDto } from './dto/get-messages.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard) // All chat endpoints require authentication
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERSATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a new conversation (or returns existing 1-on-1 conversation).
   *
   * POST /api/chat/conversations
   * Body: { participantIds: string[] }
   *
   * The authenticated user is automatically added as a participant.
   * For 1-on-1 chats, returns the existing conversation if one already exists.
   */
  @Post('conversations')
  async createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthUser,
  ) {
    const conversation = await this.chatService.createConversation(
      dto,
      user.userId,
    );
    return conversation;
  }

  /**
   * Returns all conversations for the authenticated user,
   * sorted by most recent activity (newest first).
   *
   * GET /api/chat/conversations
   *
   * Use this to populate the conversation list / sidebar in the UI.
   */
  @Get('conversations')
  async getConversations(@CurrentUser() user: AuthUser) {
    return this.chatService.getUserConversations(user.userId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGES (Cursor-Paginated History)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns a cursor-paginated page of messages for a conversation.
   *
   * GET /api/chat/messages?conversationId=xxx&limit=20
   * GET /api/chat/messages?conversationId=xxx&cursor=<ISO>&limit=20
   *
   * HOW TO USE:
   *   1. Call without `cursor` to get the most recent messages.
   *   2. When user scrolls up, call again with `cursor` = `nextCursor`
   *      from the previous response to fetch older messages.
   *   3. Stop paginating when `nextCursor` is null.
   *
   * Response shape:
   * {
   *   messages: Message[],    // Array of messages, newest-first
   *   nextCursor: string|null, // Pass this as `cursor` for next page
   *   count: number           // Number of messages in this response
   * }
   */
  @Get('messages')
  async getMessages(
    @Query() dto: GetMessagesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.getMessages(dto, user.userId);
  }
}
