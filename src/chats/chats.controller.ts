import { Controller, Post, Body } from '@nestjs/common';
import { ChatsService } from './chats.service';

@Controller('api/chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('intro')
  async intro(@Body('analysisId') analysisId: string) {
    return this.chatsService.intro(analysisId);
  }

  @Post('messages')
  async sendMessage(
    @Body('sessionId') sessionId: string,
    @Body('userMessage') userMessage: string,
  ) {
    return this.chatsService.sendMessage(sessionId, userMessage);
  }
}
