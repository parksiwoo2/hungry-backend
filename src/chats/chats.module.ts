import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SafeguardModule } from '../safeguard/safeguard.module';
import { ChatGeminiLlmService } from './chat-llm.gemini.temp';
import { ChatLlmService } from './chat-llm.service';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';

@Module({
  // 분석 결과는 SafeguardModule 이 export 하는 AnalysesService 로 읽는다
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage]),
    SafeguardModule,
  ],
  controllers: [ChatsController],
  providers: [
    ChatsService,
    {
      provide: ChatLlmService,
      inject: [ConfigService],
      // [임시] CHAT_LLM=gemini 일 때만 Gemini 구현(chat-llm.gemini.temp.ts). 기본은 Claude
      useFactory: (config: ConfigService): ChatLlmService =>
        config.get<string>('CHAT_LLM') === 'gemini'
          ? new ChatGeminiLlmService(config)
          : new ChatLlmService(config),
    },
  ],
})
export class ChatsModule {}
