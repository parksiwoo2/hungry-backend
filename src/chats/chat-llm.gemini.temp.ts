/**
 * [임시] Gemini 로 챗봇 응답을 만드는 구현.
 * Claude 키 없이 상담 흐름(인사말·위기 감지·저장)을 시험하려고 둔 것이다 — 운영에는 쓰지 않는다.
 *
 * 켜는 법   .env 에  GEMINI_API_KEY=...  와  CHAT_LLM=gemini  (모델은 GEMINI_MODEL, 기본 gemini-3.5-flash)
 * 지우는 법 이 파일, chat-llm.gemini.temp.spec.ts, chats.module.ts 의 CHAT_LLM 분기 한 곳.
 *
 * SDK(@google/generative-ai) 없이 REST 로 부른다 — package.json 에 의존성을 추가하지 않는다.
 * 키는 URL 이 아니라 x-goog-api-key 헤더로 보낸다(URL 은 로그·프록시에 남기 쉽다).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ChatLlmService, type ChatReply } from './chat-llm.service';
import type { LlmMessage } from './chat-prompt';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 30_000;

const ReplySchema = z.object({ reply: z.string(), isCrisis: z.boolean() });

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

@Injectable()
export class ChatGeminiLlmService extends ChatLlmService {
  override async reply(
    system: string,
    messages: LlmMessage[],
  ): Promise<ChatReply> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY 가 설정되지 않음');
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

    const res = await fetch(
      `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          // Gemini 는 assistant 가 아니라 model 이고, 첫 턴이 user 여야 한다(toLlmMessages 가 보장)
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                reply: { type: 'STRING' },
                isCrisis: { type: 'BOOLEAN' },
              },
              required: ['reply', 'isCrisis'],
            },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`Gemini HTTP ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) {
      throw new Error(
        `Gemini 가 요청을 차단함: ${data.promptFeedback.blockReason}`,
      );
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    if (!text) throw new Error('Gemini 가 빈 응답을 반환함');

    const parsed = ReplySchema.parse(JSON.parse(text));
    if (!parsed.reply.trim()) throw new Error('Gemini 가 빈 답변을 반환함');
    return parsed;
  }
}
