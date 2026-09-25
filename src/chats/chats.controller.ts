import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ChatsService,
  type IntroResponse,
  type MessageResponse,
} from './chats.service';
import { SendMessageDto, StartChatDto } from './dto/chat.dto';

@Controller('api/chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  /** 상담 시작 — 분석 결과를 반영한 인사말과 sessionId */
  @Post('intro')
  @HttpCode(200)
  intro(@Body() dto: StartChatDto): Promise<IntroResponse> {
    return this.chatsService.intro(dto.analysisId);
  }

  /** 메시지 전송 — 답변과 위기 여부(isCrisis), 위기면 긴급 연락처 */
  @Post('messages')
  @HttpCode(200)
  sendMessage(@Body() dto: SendMessageDto): Promise<MessageResponse> {
    return this.chatsService.sendMessage(dto.sessionId, dto.userMessage);
  }
}
