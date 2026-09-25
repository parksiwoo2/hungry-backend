/**
 * 챗봇의 LLM 호출. 응답은 { reply, isCrisis } 구조화 출력으로 받는다.
 * 안전분석 엔진(safeguard-analysis.service.ts)과 같은 SDK·키(ANTHROPIC_API_KEY)를 쓴다.
 */
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { LlmMessage } from './chat-prompt';

/** 기본 모델. CHAT_MODEL 환경변수로 바꿀 수 있다 */
const DEFAULT_MODEL = 'claude-sonnet-5-5';

const ReplySchema = z.object({
  reply: z.string().describe('내담자에게 보여줄 답변'),
  isCrisis: z
    .boolean()
    .describe('자해·자살·극단적 선택을 암시하면 true, 아니면 false'),
});
export type ChatReply = z.infer<typeof ReplySchema>;

@Injectable()
export class ChatLlmService {
  /** 지연 초기화 — 부팅·테스트 시 API 키가 없어도 모듈이 뜬다 */
  private _client?: Anthropic;
  private get client(): Anthropic {
    // 상담은 사용자가 기다리는 요청이다 — 오래 붙들지 않고 폴백으로 넘긴다
    return (this._client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 }));
  }

  async reply(system: string, messages: LlmMessage[]): Promise<ChatReply> {
    const response = await this.client.messages.create({
      model: process.env.CHAT_MODEL || DEFAULT_MODEL,
      max_tokens: 2048,
      system,
      messages,
      output_config: { format: zodOutputFormat(ReplySchema) },
    });
    if (response.stop_reason === 'refusal') {
      throw new Error('모델이 응답을 거부함(안전 분류)');
    }
    const raw = response.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('');
    const parsed = ReplySchema.parse(JSON.parse(raw));
    if (!parsed.reply.trim()) throw new Error('모델이 빈 응답을 반환함');
    return parsed;
  }
}
