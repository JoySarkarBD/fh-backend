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

import { BadRequestException, Body, Controller, Get, Logger, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetConversationsDto } from './dto/get-conversations.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import { AttachmentService } from './services/attachment.service';
import { AttachmentPayload } from './interfaces/chat.interfaces';

@Controller('chat')
@UseGuards(JwtAuthGuard) // All chat endpoints require authentication
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly attachmentService: AttachmentService,
  ) {}

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
   * Returns a cursor-paginated list of conversations for the authenticated user,
   * sorted by most recent activity (newest first). 20 per page by default.
   *
   * GET /api/chat/conversations
   * GET /api/chat/conversations?cursor=<ISO>&limit=20
   *
   * On first load, omit cursor.  On scroll, pass the `nextCursor` from the
   * previous response to load the next page of conversations.
   */
  @Get('conversations')
  async getConversations(
    @Query() dto: GetConversationsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.getUserConversations(
      user.userId,
      dto.cursor,
      dto.limit ?? 20,
    );
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

  // ─────────────────────────────────────────────────────────────────────────────
  // UPLOADS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Upload files to S3 for chat attachments.
   *
   * POST /api/chat/upload
   * Form-Data: files (up to 10 files)
   * 
   * Returns list of AttachmentPayload objects to send over sockets.
   */
  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      fileFilter: (req, file, callback) => {
        const allowedMimeTypes = [
          // Images
          'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
          // PDF
          'application/pdf',
          // Word
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          // PowerPoint
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          // Excel
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];

        if (!allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(`Unsupported file type: ${file.mimetype}. Allowed types: Images, PDF, Word, PowerPoint, Excel`),
            false,
          );
        }
        callback(null, true);
      },
      limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB max
      },
    }),
  )
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthUser,
  ): Promise<{ urls: AttachmentPayload[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const maxFiles = 10;
    if (files.length > maxFiles) {
      throw new BadRequestException(`Maximum ${maxFiles} files allowed`);
    }

    const payloads: AttachmentPayload[] = [];
    const timestamp = new Date().toISOString();

    for (const file of files) {
      try {
        const url = await this.attachmentService.uploadAttachment(file);
        
        // Extract key. Simplistic approach from full URL since aws.service doesn't return the key directly here.
        const urlObj = new URL(url);
        const key = urlObj.pathname.substring(1); 
        
        payloads.push({
          key,
          url,
          mimeType: file.mimetype,
          size: file.size,
          uploadedBy: user.userId,
          createdAt: timestamp,
        });
      } catch (error) {
        this.logger.error(`Failed to upload file ${file.originalname}`, error);
        throw new BadRequestException(`Failed to upload file ${file.originalname}`);
      }
    }

    return { urls: payloads };
  }
}
