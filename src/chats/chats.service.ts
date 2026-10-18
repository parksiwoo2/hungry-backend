/**
 * AI 심리 상담 챗봇 — 분석 결과를 맥락으로 주입해 대화하고, 위기 발화를 감지한다.
 *
 *   POST /chats/intro     분석으로 세션을 만들고 첫 인사말을 돌려준다
 *   POST /chats/messages  사용자 메시지에 답하고, 위기면 세션을 닫고 긴급 연락처를 준다
 *
 * 저장은 Postgres(chat_sessions · chat_messages). 이력은 서버가 들고 있어서
 * 클라이언트는 sessionId 만 넘긴다. 분석 결과는 AnalysesService 로 읽는다(저장소를 직접 만지지 않는다).
 */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AnalysesService } from '../safeguard/analyses.service';
import type { AnalysisResponse } from '../safeguard/analyses.service';
import { ChatLlmService, type ChatReply } from './chat-llm.service';
import {
  CRISIS_FALLBACK_REPLY,
  EMERGENCY_CONTACTS,
  FALLBACK_REPLY,
  INTRO_TRIGGER,
  MAX_HISTORY_MESSAGES,
  buildSystemPrompt,
  fallbackGreeting,
  hasCrisisKeyword,
  toLlmMessages,
  type EmergencyContact,
} from './chat-prompt';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession, ChatSessionStatus } from './entities/chat-session.entity';

export interface IntroResponse {
  sessionId: string;
  greeting: string;
}

export interface MessageResponse {
  reply: string;
  isCrisis: boolean;
  emergencyContacts: EmergencyContact[] | null;
  /**
   * true 면 reply 는 모델 응답이 아니라 "연결이 어렵다"는 고정 안내 문구다.
   * 이때는 아무것도 저장하지 않았으므로 같은 요청을 그대로 다시 보내도 된다(클라이언트가 재시도).
   * 위기 경로의 고정 문구(CRISIS_FALLBACK_REPLY)는 저장·종료까지 끝난 최종 응답이라 false 다.
   */
  fallback: boolean;
}

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessions: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    private readonly dataSource: DataSource,
    private readonly analyses: AnalysesService,
    private readonly llm: ChatLlmService,
  ) {}

  async intro(analysisId: string): Promise<IntroResponse> {
    const analysis = await this.analyses.get(analysisId); // 없으면 404
    this.assertReady(analysis);

    let greeting: string;
    try {
      const out = await this.llm.reply(buildSystemPrompt(analysis), [
        { role: 'user', content: INTRO_TRIGGER },
      ]);
      greeting = out.reply;
    } catch (e) {
      this.logError('인사말 생성 실패', e);
      greeting = fallbackGreeting(analysis.victimName);
    }

    const session = await this.dataSource.transaction(async (em) => {
      const created = await em.save(em.create(ChatSession, { analysisId }));
      await em.insert(ChatMessage, {
        sessionId: created.id,
        seq: 1,
        role: 'assistant',
        content: greeting,
      });
      return created;
    });
    return { sessionId: session.id, greeting };
  }

  async sendMessage(
    sessionId: string,
    userMessage: string,
  ): Promise<MessageResponse> {
    const session = await this.sessions.findOneBy({ id: sessionId });
    if (!session) throw new NotFoundException('상담 세션 없음');
    if (session.status === ChatSessionStatus.CRISIS_CLOSED) {
      // 상담이 끊긴 사용자가 빈손이 되지 않게 연락처를 같이 준다
      throw new ConflictException({
        message:
          '위기 상황으로 종료된 상담입니다. 아래 연락처로 도움을 요청해 주세요.',
        emergencyContacts: EMERGENCY_CONTACTS,
      });
    }
    if (session.status !== ChatSessionStatus.ACTIVE) {
      throw new ConflictException('종료된 상담입니다');
    }

    const analysis = await this.analyses.get(session.analysisId);
    const recent = await this.messages.find({
      where: { sessionId },
      order: { seq: 'DESC' },
      take: MAX_HISTORY_MESSAGES,
    });
    const history = recent.reverse();
    const nextSeq = (history.at(-1)?.seq ?? 0) + 1;

    // 키워드는 LLM 판정의 안전망 — 모델이 놓치거나 호출이 실패해도 명백한 표현은 잡는다
    const keywordCrisis = hasCrisisKeyword(userMessage);
    let out: ChatReply;
    try {
      out = await this.llm.reply(
        buildSystemPrompt(analysis),
        toLlmMessages(history, userMessage),
      );
    } catch (e) {
      this.logError('응답 생성 실패', e);
      // 일반 메시지는 아무것도 저장하지 않는다 — fallback:true 로 알려 클라이언트가 같은 요청을 재시도한다
      if (!keywordCrisis) {
        return {
          reply: FALLBACK_REPLY,
          isCrisis: false,
          emergencyContacts: null,
          fallback: true,
        };
      }
      out = { reply: CRISIS_FALLBACK_REPLY, isCrisis: true };
    }

    const isCrisis = out.isCrisis || keywordCrisis;
    await this.saveTurn(sessionId, nextSeq, userMessage, out.reply, isCrisis);

    return {
      reply: out.reply,
      isCrisis,
      emergencyContacts: isCrisis ? EMERGENCY_CONTACTS : null,
      fallback: false,
    };
  }

  /** 분석이 끝나지 않았거나 실패했으면 맥락으로 쓸 수 없다 */
  private assertReady(analysis: AnalysisResponse): void {
    if (analysis.status !== 'done' || !analysis.summary) {
      throw new ConflictException(
        '분석이 완료되지 않아 상담을 시작할 수 없습니다',
      );
    }
  }

  /** 사용자 메시지와 답변을 한 트랜잭션으로 저장한다. 위기면 같은 트랜잭션에서 세션을 닫는다 */
  private async saveTurn(
    sessionId: string,
    seq: number,
    userMessage: string,
    reply: string,
    closeAsCrisis: boolean,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        await em.insert(ChatMessage, [
          { sessionId, seq, role: 'user', content: userMessage },
          { sessionId, seq: seq + 1, role: 'assistant', content: reply },
        ]);
        if (closeAsCrisis) {
          await em.update(
            ChatSession,
            { id: sessionId },
            { status: ChatSessionStatus.CRISIS_CLOSED },
          );
        }
      });
    } catch (e) {
      // 같은 세션에 메시지가 동시에 들어와 순번이 겹친 경우
      if (
        e instanceof QueryFailedError &&
        (e.driverError as { code?: string } | undefined)?.code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          '이전 메시지를 처리하는 중입니다. 잠시 후 다시 보내 주세요.',
        );
      }
      throw e;
    }
  }

  /** 상담 내용(사용자 메시지)은 로그에 남기지 않는다 — 원인만 기록 */
  private logError(what: string, e: unknown): void {
    this.logger.error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
