import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AwsService } from 'src/common/aws/aws.service';
import type { AuthUser } from 'src/common/interface/auth-user.interface';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import { MarkSeenDto } from './dto/mark-seen.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly awsService: AwsService,
  ) {}

  @Post('conversations')
  async createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.createConversation(dto, user.userId);
  }

  @Get('conversations')
  async getConversations(@CurrentUser() user: AuthUser) {
    return this.chatService.getUserConversations(user.userId);
  }

  @Get('messages')
  async getMessages(@Query() dto: GetMessagesDto, @CurrentUser() user: AuthUser) {
    return this.chatService.getMessages(dto, user.userId);
  }

  @Post('messages')
  async createMessage(
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.createMessage(dto, user.userId);
  }

  @Patch('messages/:id/unsend')
  async unsendMessage(@Param() param: MongoIdDto, @CurrentUser() user: AuthUser) {
    return this.chatService.unsendMessage(param.id, user.userId);
  }

  @Patch('messages/:id/delete-for-me')
  async deleteForMe(@Param() param: MongoIdDto, @CurrentUser() user: AuthUser) {
    return this.chatService.deleteMessageForMe(param.id, user.userId);
  }

  @Post('messages/:id/forward')
  async forwardMessage(
    @Param() param: MongoIdDto,
    @Body() dto: ForwardMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chatService.forwardMessage(param.id, dto, user.userId);
  }

  @Patch('messages/seen')
  async markSeen(@Body() dto: MarkSeenDto, @CurrentUser() user: AuthUser) {
    return this.chatService.markConversationSeen(dto.conversationId, user.userId);
  }

  @Get('presence/:userId')
  async getPresence(@Param('userId') userId: string) {
    return this.chatService.getPresence(userId);
  }

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async uploadAttachments(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const safeFiles = Array.isArray(files) ? files : [];
    if (!safeFiles.length) {
      return { urls: [] };
    }

    const urls = await this.awsService.uploadMultipleFiles(
      safeFiles,
      `chat/${user.userId}/attachments`,
    );

    return { urls };
  }
}
