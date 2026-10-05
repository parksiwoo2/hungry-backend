/**
 * SafeguardStore 의 Postgres 구현 — 팀 DB(TypeORM DataSource)를 그대로 쓴다.
 *
 * 스키마는 마이그레이션(migrations/…-create-safeguard-tables.ts)이 만든다.
 * 엔티티 없이 SQL 로 쓴다 — 조회 패턴이 몇 개뿐이고 계약(safeguard-store.ts)이 이미 타입을 고정한다.
 * 배열·객체는 json 컬럼이다. pg 드라이버는 JS 배열을 Postgres 배열 리터럴로 바꾸므로
 * 반드시 JSON.stringify 한 문자열을 $n::json 으로 넘긴다. 읽을 때는 드라이버가 파싱해 준다.
 */
import type { DataSource } from 'typeorm';
import {
  newId,
  type AnalysisListItem,
  type AnalysisOutcome,
  type AnalysisRecord,
  type AnalysisStatus,
  type AnalysisWithUtterances,
  type NewAnalysis,
  type NewSession,
  type SafeguardStore,
  type SessionFormat,
  type SessionRecord,
  type SessionSource,
  type UtteranceRecord,
} from './safeguard-store';
import type {
  ChatContext,
  ChatMessage,
  Summary,
} from '../safeguard-analysis.service';

interface SessionRow {
  id: string;
  source: string;
  format: string;
  messages: ChatMessage[];
  message_count: number;
  system_event_count: number;
  participants: SessionRecord['participants'];
  period_from: string | null;
  period_to: string | null;
  created_at: Date;
}

interface AnalysisRow {
  id: string;
  context: string;
  victim_name: string;
  participant_count: number;
  status: string;
  error: string | null;
  patterns: string[];
  summary: Summary | null;
  precedents: Record<string, string>;
  created_at: Date;
  finished_at: Date | null;
  /** 조인 테이블에서 ord 순으로 모은 세션 ID */
  session_ids: string[];
}

interface UtteranceRow {
  id: string;
  analysis_id: string;
  session_id: string;
  seq: number;
  message_nos: number[];
  harm_types: string[];
  severity: string;
  reason: string;
  applied_precedent_ids: string[];
  excluded: boolean;
}

/** 분석 행 + 연결된 세션 ID 배열 (ord 순). 세션이 없으면 빈 배열 */
const ANALYSIS_SELECT = `
  SELECT a.*,
         COALESCE(
           (SELECT json_agg(l.session_id ORDER BY l.ord)
              FROM safeguard_analysis_sessions l WHERE l.analysis_id = a.id),
           '[]'::json
         ) AS session_ids
    FROM safeguard_analyses a`;

const json = (v: unknown) => JSON.stringify(v);

export class PostgresSafeguardStore implements SafeguardStore {
  constructor(private readonly db: DataSource) {}

  // ── 세션 ─────────────────────────────────────────────────────────

  async createSession(s: NewSession): Promise<SessionRecord> {
    const rec: SessionRecord = {
      ...s,
      id: newId('ses'),
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `INSERT INTO safeguard_sessions
         (id, source, format, messages, message_count, system_event_count,
          participants, period_from, period_to, created_at)
       VALUES ($1, $2, $3, $4::json, $5, $6, $7::json, $8, $9, $10)`,
      [
        rec.id,
        rec.source,
        rec.format,
        json(rec.messages),
        rec.messageCount,
        rec.systemEventCount,
        json(rec.participants),
        rec.period?.from ?? null,
        rec.period?.to ?? null,
        rec.createdAt,
      ],
    );
    return rec;
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const rows = await this.db.query<SessionRow[]>(
      'SELECT * FROM safeguard_sessions WHERE id = $1',
      [id],
    );
    return rows[0] ? this.toSession(rows[0]) : null;
  }

  async analysisIdsForSession(id: string): Promise<string[]> {
    const rows = await this.db.query<{ analysis_id: string }[]>(
      `SELECT l.analysis_id
         FROM safeguard_analysis_sessions l
         JOIN safeguard_analyses a ON a.id = l.analysis_id
        WHERE l.session_id = $1
        ORDER BY a.seq`,
      [id],
    );
    return rows.map((r) => r.analysis_id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }[]>(
      'DELETE FROM safeguard_sessions WHERE id = $1 RETURNING id',
      [id],
    );
    return rows.length > 0;
  }

  private toSession(r: SessionRow): SessionRecord {
    return {
      id: r.id,
      source: r.source as SessionSource,
      format: r.format as SessionFormat,
      messages: r.messages,
      messageCount: r.message_count,
      systemEventCount: r.system_event_count,
      participants: r.participants,
      period:
        r.period_from && r.period_to
          ? { from: r.period_from, to: r.period_to }
          : null,
      createdAt: r.created_at.toISOString(),
    };
  }

  // ── 분석 ─────────────────────────────────────────────────────────

  async createAnalysis(a: NewAnalysis): Promise<AnalysisRecord> {
    const rec: AnalysisRecord = {
      ...a,
      id: newId('ana'),
      status: 'running',
      error: null,
      patterns: [],
      summary: null,
      precedents: {},
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO safeguard_analyses
           (id, context, victim_name, participant_count, status, created_at)
         VALUES ($1, $2, $3, $4, 'running', $5)`,
        [
          rec.id,
          rec.context,
          rec.victimName,
          rec.participantCount,
          rec.createdAt,
        ],
      );
      for (const [ord, sessionId] of rec.sessionIds.entries()) {
        await tx.query(
          `INSERT INTO safeguard_analysis_sessions (analysis_id, session_id, ord)
           VALUES ($1, $2, $3)`,
          [rec.id, sessionId, ord],
        );
      }
    });
    return rec;
  }

  async completeAnalysis(id: string, o: AnalysisOutcome): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE safeguard_analyses
            SET status = 'done', error = NULL, patterns = $1::json, summary = $2::json,
                precedents = $3::json, finished_at = $4
          WHERE id = $5`,
        [
          json(o.patterns),
          json(o.summary),
          json(o.precedents),
          new Date().toISOString(),
          id,
        ],
      );
      await tx.query(
        'DELETE FROM safeguard_utterances WHERE analysis_id = $1',
        [id],
      );
      for (const u of o.utterances) {
        await tx.query(
          `INSERT INTO safeguard_utterances
             (id, analysis_id, session_id, seq, message_nos, harm_types,
              severity, reason, applied_precedent_ids, excluded)
           VALUES ($1, $2, $3, $4, $5::json, $6::json, $7, $8, $9::json, $10)`,
          [
            newId('utt'),
            id,
            u.sessionId,
            u.seq,
            json(u.messageNos),
            json(u.harmTypes),
            u.severity,
            u.reason,
            json(u.appliedPrecedentIds),
            u.excluded,
          ],
        );
      }
    });
  }

  async failAnalysis(id: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE safeguard_analyses SET status = 'error', error = $1, finished_at = $2 WHERE id = $3`,
      [error, new Date().toISOString(), id],
    );
  }

  async getAnalysis(id: string): Promise<AnalysisWithUtterances | null> {
    const rows = await this.db.query<AnalysisRow[]>(
      `${ANALYSIS_SELECT} WHERE a.id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    const utterances = await this.db.query<UtteranceRow[]>(
      'SELECT * FROM safeguard_utterances WHERE analysis_id = $1 ORDER BY seq',
      [id],
    );
    return {
      ...this.toAnalysis(rows[0]),
      utterances: utterances.map((u) => this.toUtterance(u)),
    };
  }

  async listAnalyses(
    limit: number,
    offset: number,
  ): Promise<AnalysisListItem[]> {
    const rows = await this.db.query<
      (AnalysisRow & { utterance_count: number; urgent_count: number })[]
    >(
      `SELECT x.*,
              (SELECT COUNT(*)::int FROM safeguard_utterances u
                WHERE u.analysis_id = x.id) AS utterance_count,
              (SELECT COUNT(*)::int FROM safeguard_utterances u
                WHERE u.analysis_id = x.id AND u.severity = '즉시조치') AS urgent_count
         FROM (${ANALYSIS_SELECT}) x
        ORDER BY x.created_at DESC, x.seq DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map((r) => ({
      ...this.toAnalysis(r),
      utteranceCount: r.utterance_count,
      urgentCount: r.urgent_count,
    }));
  }

  async deleteAnalysis(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }[]>(
      'DELETE FROM safeguard_analyses WHERE id = $1 RETURNING id',
      [id],
    );
    return rows.length > 0;
  }

  private toAnalysis(r: AnalysisRow): AnalysisRecord {
    return {
      id: r.id,
      sessionIds: r.session_ids,
      context: r.context as ChatContext,
      victimName: r.victim_name,
      participantCount: r.participant_count,
      status: r.status as AnalysisStatus,
      error: r.error,
      patterns: r.patterns,
      summary: r.summary,
      precedents: r.precedents,
      createdAt: r.created_at.toISOString(),
      finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    };
  }

  private toUtterance(u: UtteranceRow): UtteranceRecord {
    return {
      id: u.id,
      analysisId: u.analysis_id,
      sessionId: u.session_id,
      seq: u.seq,
      messageNos: u.message_nos,
      harmTypes: u.harm_types,
      severity: u.severity,
      reason: u.reason,
      appliedPrecedentIds: u.applied_precedent_ids,
      excluded: u.excluded,
    };
  }
}
