/**
 * 분석 = 세션(들)에 2패스 엔진을 돌린 결과 한 건 (팀 데이터 모델의 analysis).
 * 의심 구간(utterance)은 엔진의 flagged 항목을 그대로 저장한 것이다.
 *
 * 엔진(SafeguardAnalysisService)은 손대지 않는다 — 여기는 검증·저장·응답 변환만 한다.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  SafeguardAnalysisService,
  type AnalyzeInput,
  type FlaggedItem,
  type Summary,
} from './safeguard-analysis.service';
import { ReportPdfService } from './report-pdf.service';
import { SessionsService } from './sessions.service';
import {
  SAFEGUARD_STORE,
  type AnalysisRecord,
  type AnalysisWithUtterances,
  type SafeguardStore,
  type SessionRecord,
  type UtteranceRecord,
} from './storage/safeguard-store';
import type { CreateAnalysisDto } from './dto/analysis.dto';

export type StageListener = (
  stage: string,
  data?: Record<string, number>,
) => void;

export interface UtteranceResponse {
  utteranceId: string;
  sessionId: string;
  messageNos: number[];
  harmTypes: string[];
  severity: string;
  reason: string;
  appliedPrecedentIds: string[];
  excluded: boolean;
  messages: { no: number; time: string; sender: string; text: string }[];
}

export interface AnalysisSummaryResponse {
  total: number;
  urgentCount: number;
  typeCounts: Record<string, number>;
  attackerCounts: Record<string, number>;
  distinctDays: number;
  isRepeated: boolean;
  period: { from: string; to: string } | null;
}

export interface AnalysisResponse {
  analysisId: string;
  status: AnalysisRecord['status'];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  sessionIds: string[];
  context: AnalysisRecord['context'];
  participantCount: number;
  victimName: string;
  utterances: UtteranceResponse[];
  patterns: string[];
  summary: AnalysisSummaryResponse | null;
  precedents: Record<string, string>;
}

export interface AnalysisListItemResponse {
  analysisId: string;
  status: AnalysisRecord['status'];
  createdAt: string;
  context: AnalysisRecord['context'];
  victimName: string;
  utteranceCount: number;
  urgentCount: number;
  patterns: string[];
}

/** GET /api/analyses — 노션 명세대로 배열을 analyses 키로 감싼다 */
export interface AnalysisListResponse {
  analyses: AnalysisListItemResponse[];
}

/** 검증을 통과해 실행만 남은 분석 — 컨트롤러는 이걸 받은 뒤에 스트림을 연다 */
export interface PreparedAnalysis {
  session: SessionRecord;
  input: AnalyzeInput;
  dto: CreateAnalysisDto;
}

export type RunOutcome =
  | { ok: true; analysis: AnalysisResponse }
  | { ok: false; analysisId: string; message: string };

@Injectable()
export class AnalysesService {
  private readonly logger = new Logger(AnalysesService.name);

  constructor(
    @Inject(SAFEGUARD_STORE) private readonly store: SafeguardStore,
    private readonly engine: SafeguardAnalysisService,
    private readonly sessions: SessionsService,
    private readonly pdf: ReportPdfService,
  ) {}

  /**
   * 세션 존재(404)·피해자 참여 여부(400)를 스트림을 열기 전에 검사한다.
   * 지금은 세션 1개씩만 — 엔진이 대화 하나를 한 문맥(context)으로 보기 때문이다.
   */
  async prepare(dto: CreateAnalysisDto): Promise<PreparedAnalysis> {
    if (dto.sessionIds.length !== 1) {
      throw new BadRequestException(
        '지금은 세션 1개씩만 분석합니다 (여러 자료 동시 분석은 미지원)',
      );
    }
    const session = await this.sessions.get(dto.sessionIds[0]);
    const names = session.participants.map((p) => p.name);
    if (!names.includes(dto.victimName)) {
      throw new BadRequestException('victimName이 세션 참여자에 없음');
    }
    return {
      session,
      dto,
      input: {
        messages: session.messages,
        context: dto.context,
        participantCount: names.length,
        victimName: dto.victimName,
        victimInRoom: true,
      },
    };
  }

  /** 분석 행을 running 으로 만들고 엔진을 돌린 뒤 done/error 로 닫는다 */
  async run(p: PreparedAnalysis, onStage: StageListener): Promise<RunOutcome> {
    const { session, input, dto } = p;
    const analysis = await this.store.createAnalysis({
      sessionIds: [session.id],
      context: dto.context,
      victimName: dto.victimName,
      participantCount: input.participantCount,
    });
    const t0 = Date.now();
    this.logger.log(
      `분석 시작 ${analysis.id} — ${session.messageCount}건 · ${dto.context} · 참여 ${input.participantCount}명`,
    );
    try {
      const r = await this.engine.analyze(input, { onStage });
      const summary = this.engine.aggregate(r.flagged, session.messages);
      await this.store.completeAnalysis(analysis.id, {
        patterns: r.patterns,
        summary,
        precedents: AnalysesService.appliedPrecedents(
          r.trace.matched?.precedentDict ?? {},
          r.flagged,
        ),
        utterances: r.flagged.map((f, seq) => ({
          sessionId: session.id,
          seq,
          messageNos: f.messageNos,
          harmTypes: f.harmTypes,
          severity: f.severity,
          reason: f.reason,
          appliedPrecedentIds: f.appliedPrecedentIds,
          excluded: false,
        })),
      });
      this.logger.log(
        `분석 완료 ${analysis.id} — 확정 ${r.flagged.length}건 · 패턴 [${r.patterns.join(',')}] · ${((Date.now() - t0) / 1000).toFixed(1)}초`,
      );
      return { ok: true, analysis: await this.get(analysis.id) };
    } catch (e) {
      const message = e instanceof Error ? e.message : '분석에 실패했습니다';
      await this.store.failAnalysis(analysis.id, message);
      this.logger.error(`분석 실패 ${analysis.id} — ${message}`);
      return { ok: false, analysisId: analysis.id, message };
    }
  }

  /** 매칭 후보 전체 중 2차가 실제 근거로 쓴 판례만 남긴다 */
  static appliedPrecedents(
    dict: Record<string, string>,
    flagged: FlaggedItem[],
  ): Record<string, string> {
    const used = new Set(flagged.flatMap((f) => f.appliedPrecedentIds));
    return Object.fromEntries(
      Object.entries(dict).filter(([id]) => used.has(id)),
    );
  }

  async get(id: string): Promise<AnalysisResponse> {
    const a = await this.store.getAnalysis(id);
    if (!a) throw new NotFoundException('분석 없음');
    const sessions = new Map<string, SessionRecord>();
    for (const sid of a.sessionIds) {
      const s = await this.store.getSession(sid);
      if (s) sessions.set(sid, s);
    }
    return AnalysesService.toResponse(a, sessions);
  }

  async list(limit: number, offset: number): Promise<AnalysisListResponse> {
    const rows = await this.store.listAnalyses(limit, offset);
    const analyses = rows.map((r) => ({
      analysisId: r.id,
      status: r.status,
      createdAt: r.createdAt,
      context: r.context,
      victimName: r.victimName,
      utteranceCount: r.utteranceCount,
      urgentCount: r.urgentCount,
      patterns: r.patterns,
    }));
    return { analyses };
  }

  async remove(id: string): Promise<void> {
    if (!(await this.store.deleteAnalysis(id))) {
      throw new NotFoundException('분석 없음');
    }
  }

  /**
   * 정리 문서 PDF. 제외(excluded)된 구간은 빼고, 집계는 남은 구간으로 다시 센다.
   * legal=false 면 법조·판례·대응 절차 없이 사실 정리만 싣는다.
   */
  async report(id: string, legal: boolean): Promise<Buffer> {
    const a = await this.store.getAnalysis(id);
    if (!a) throw new NotFoundException('분석 없음');
    if (a.status !== 'done') {
      throw new ConflictException(`분석이 끝나지 않았습니다 (${a.status})`);
    }
    const session = await this.sessions.get(a.sessionIds[0]);
    const flagged = a.utterances
      .filter((u) => !u.excluded)
      .map((u) => AnalysesService.toFlagged(u));
    const input: AnalyzeInput = {
      messages: session.messages,
      context: a.context,
      participantCount: a.participantCount,
      victimName: a.victimName,
      victimInRoom: true,
    };
    const pdf = await this.pdf.generate({
      input,
      result: { flagged, patterns: a.patterns },
      summary: this.engine.aggregate(flagged, session.messages),
      legal,
    });
    this.logger.log(
      `정리 문서 생성 ${id} — ${(pdf.length / 1024).toFixed(0)}KB · ${flagged.length}건 · legal=${legal}`,
    );
    return pdf;
  }

  /** 저장된 구간 → 엔진의 flagged 항목. 값은 엔진이 낸 것이라 enum 범위 안이다 */
  static toFlagged(u: UtteranceRecord): FlaggedItem {
    return {
      messageNos: u.messageNos,
      harmTypes: u.harmTypes,
      severity: u.severity,
      reason: u.reason,
      appliedPrecedentIds: u.appliedPrecedentIds,
    } as FlaggedItem;
  }

  static toResponse(
    a: AnalysisWithUtterances,
    sessions: Map<string, SessionRecord>,
  ): AnalysisResponse {
    return {
      analysisId: a.id,
      status: a.status,
      error: a.error,
      createdAt: a.createdAt,
      finishedAt: a.finishedAt,
      sessionIds: a.sessionIds,
      context: a.context,
      participantCount: a.participantCount,
      victimName: a.victimName,
      utterances: a.utterances.map((u) => ({
        utteranceId: u.id,
        sessionId: u.sessionId,
        messageNos: u.messageNos,
        harmTypes: u.harmTypes,
        severity: u.severity,
        reason: u.reason,
        appliedPrecedentIds: u.appliedPrecedentIds,
        excluded: u.excluded,
        messages: u.messageNos.flatMap((no) => {
          const m = sessions.get(u.sessionId)?.messages[no - 1];
          return m
            ? [{ no, time: m.time, sender: m.sender, text: m.text }]
            : [];
        }),
      })),
      patterns: a.patterns,
      summary: a.summary ? AnalysesService.toSummary(a.summary) : null,
      precedents: a.precedents,
    };
  }

  static toSummary(s: Summary): AnalysisSummaryResponse {
    return {
      total: s.count,
      urgentCount: s.urgentCount,
      typeCounts: s.typeCounts,
      attackerCounts: s.attackerCounts,
      distinctDays: s.distinctDays,
      isRepeated: s.isRepeated,
      period: s.start && s.end ? { from: s.start, to: s.end } : null,
    };
  }
}
