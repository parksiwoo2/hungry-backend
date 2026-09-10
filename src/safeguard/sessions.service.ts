/**
 * 세션 = 사용자가 올린 자료 한 건 (팀 데이터 모델의 session).
 * 원문을 파싱해 저장하고, 참여자 목록(피해자 선택용)과 형식을 함께 돌려준다.
 * 파서·참여자 집계는 여기가 단일 소스다 — 클라이언트는 파싱하지 않는다.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseKakao } from './kakao-parser';
import {
  SAFEGUARD_STORE,
  type NewSession,
  type SafeguardStore,
  type SessionFormat,
  type SessionRecord,
  type SessionSource,
} from './storage/safeguard-store';

/** PC 내보내기의 메시지 줄 `[이름] [오후 2:20] 본문` */
const RE_PC_LINE = /^\[[^\]]+\]\s*\[(오전|오후)\s*\d{1,2}:\d{2}\]/m;

export interface SessionResponse {
  sessionId: string;
  source: SessionSource;
  format: SessionFormat;
  messageCount: number;
  systemEventCount: number;
  participants: SessionRecord['participants'];
  period: SessionRecord['period'];
  analysisIds: string[];
  createdAt: string;
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(SAFEGUARD_STORE) private readonly store: SafeguardStore,
  ) {}

  /** 원문 → 세션 레코드(저장 전). 형식을 못 읽으면 400 */
  build(rawText: string, source: SessionSource = 'kakao_export'): NewSession {
    const messages = parseKakao(rawText);
    if (messages.length === 0) {
      throw new BadRequestException('지원하지 않는 내보내기 형식');
    }
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (m.systemEvent) continue;
      counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
    }
    const participants = [...counts]
      .map(([name, messageCount]) => ({ name, messageCount }))
      .sort((a, b) => b.messageCount - a.messageCount);
    const times = messages
      .map((m) => m.time)
      .filter(Boolean)
      .sort();
    return {
      source,
      format: SessionsService.detectFormat(rawText, participants.length),
      messages,
      messageCount: messages.length, // 시스템 줄 포함 — messageNos 가 이 번호 체계를 쓴다
      systemEventCount: messages.filter((m) => m.systemEvent).length,
      participants,
      period: times.length
        ? { from: times[0], to: times[times.length - 1] }
        : null,
    };
  }

  /** PC형은 줄 형식으로 구분되고, 모바일은 1:1·그룹 형식이 같아 참여자 수로 나눈다 */
  static detectFormat(
    rawText: string,
    participantCount: number,
  ): SessionFormat {
    if (RE_PC_LINE.test(rawText)) return 'kakao_pc';
    return participantCount <= 2 ? 'kakao_mobile_dm' : 'kakao_mobile_group';
  }

  create(rawText: string, source?: SessionSource): Promise<SessionRecord> {
    return this.store.createSession(this.build(rawText, source));
  }

  async get(id: string): Promise<SessionRecord> {
    const s = await this.store.getSession(id);
    if (!s) throw new NotFoundException('세션 없음');
    return s;
  }

  async getResponse(id: string): Promise<SessionResponse> {
    const s = await this.get(id);
    return SessionsService.toResponse(
      s,
      await this.store.analysisIdsForSession(id),
    );
  }

  /** 분석이 이 세션을 쓰고 있으면 409 — 분석을 먼저 지워야 한다 */
  async remove(id: string): Promise<void> {
    await this.get(id);
    const analysisIds = await this.store.analysisIdsForSession(id);
    if (analysisIds.length > 0) {
      throw new ConflictException({
        message: '분석에 사용 중인 세션',
        analysisIds,
      });
    }
    await this.store.deleteSession(id);
  }

  static toResponse(s: SessionRecord, analysisIds: string[]): SessionResponse {
    return {
      sessionId: s.id,
      source: s.source,
      format: s.format,
      messageCount: s.messageCount,
      systemEventCount: s.systemEventCount,
      participants: s.participants,
      period: s.period,
      analysisIds,
      createdAt: s.createdAt,
    };
  }
}
