/**
 *   POST   /api/sessions              대화 내보내기 원문 업로드·파싱 → 참여자 목록
 *   GET    /api/sessions/:sessionId   세션 메타 조회 (메시지 원문은 주지 않는다)
 *   DELETE /api/sessions/:sessionId   세션 삭제 (분석이 쓰고 있으면 409)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/session.dto';

@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  async create(@Body() dto: CreateSessionDto) {
    const s = await this.sessions.create(dto.rawText, dto.source);
    return SessionsService.toResponse(s, []);
  }

  @Get(':sessionId')
  get(@Param('sessionId') id: string) {
    return this.sessions.getResponse(id);
  }

  @Delete(':sessionId')
  @HttpCode(204)
  async remove(@Param('sessionId') id: string) {
    await this.sessions.remove(id);
  }
}
