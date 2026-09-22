/**
 * SafeguardStore 의 SQLite 구현 (better-sqlite3, 동기 API).
 *
 * 팀 DB가 정해지기 전까지의 저장소. 파일 하나(data/safeguard.sqlite)로 동작하고
 * 테스트는 ':memory:' 로 연다. 스키마는 부팅 때 CREATE IF NOT EXISTS 로 만든다.
 *
 * 배열·객체 필드는 JSON 문자열 컬럼(*_json)에 넣는다 — 조회 조건으로 쓰지 않으므로
 * 정규화하지 않았다. 세션↔분석은 조인 테이블(analysis_sessions)로 잇고,
 * 세션 삭제는 분석이 남아 있으면 FK(RESTRICT)가 막는다 — 서비스가 먼저 409로 거르지만
 * DB에서도 한 번 더 지킨다.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { OnModuleDestroy } from '@nestjs/common';
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

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT PRIMARY KEY,
  source             TEXT NOT NULL,
  format             TEXT NOT NULL,
  messages_json      TEXT NOT NULL,
  message_count      INTEGER NOT NULL,
  system_event_count INTEGER NOT NULL,
  participants_json  TEXT NOT NULL,
  period_from        TEXT,
  period_to          TEXT,
  created_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  id                TEXT PRIMARY KEY,
  context           TEXT NOT NULL,
  victim_name       TEXT NOT NULL,
  participant_count INTEGER NOT NULL,
  status            TEXT NOT NULL,
  error             TEXT,
  patterns_json     TEXT NOT NULL DEFAULT '[]',
  summary_json      TEXT,
  precedents_json   TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  finished_at       TEXT
);
CREATE TABLE IF NOT EXISTS analysis_sessions (
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  ord         INTEGER NOT NULL,
  PRIMARY KEY (analysis_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_session ON analysis_sessions(session_id);
CREATE TABLE IF NOT EXISTS utterances (
  id                         TEXT PRIMARY KEY,
  analysis_id                TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  session_id                 TEXT NOT NULL,
  seq                        INTEGER NOT NULL,
  message_nos_json           TEXT NOT NULL,
  harm_types_json            TEXT NOT NULL,
  severity                   TEXT NOT NULL,
  reason                     TEXT NOT NULL,
  applied_precedent_ids_json TEXT NOT NULL,
  excluded                   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_utterances_analysis ON utterances(analysis_id, seq);
`;

interface SessionRow {
  id: string;
  source: string;
  format: string;
  messages_json: string;
  message_count: number;
  system_event_count: number;
  participants_json: string;
  period_from: string | null;
  period_to: string | null;
  created_at: string;
}

interface AnalysisRow {
  id: string;
  context: string;
  victim_name: string;
  participant_count: number;
  status: string;
  error: string | null;
  patterns_json: string;
  summary_json: string | null;
  precedents_json: string;
  created_at: string;
  finished_at: string | null;
}

interface UtteranceRow {
  id: string;
  analysis_id: string;
  session_id: string;
  seq: number;
  message_nos_json: string;
  harm_types_json: string;
  severity: string;
  reason: string;
  applied_precedent_ids_json: string;
  excluded: number;
}

const now = () => new Date().toISOString();

export class SqliteSafeguardStore implements SafeguardStore, OnModuleDestroy {
  private readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(DDL);
  }

  onModuleDestroy() {
    this.db.close();
  }

  /** 동기 better-sqlite3 호출을 Promise 계약에 맞춘다 — 제약 위반 같은 동기 예외도 reject 로 나간다 */
  private task<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve) => resolve(fn()));
  }

  // ── 세션 ─────────────────────────────────────────────────────────

  createSession(s: NewSession): Promise<SessionRecord> {
    return this.task(() => {
      const rec: SessionRecord = { ...s, id: newId('ses'), createdAt: now() };
      this.db
        .prepare(
          `INSERT INTO sessions (id, source, format, messages_json, message_count, system_event_count,
                               participants_json, period_from, period_to, created_at)
         VALUES (@id, @source, @format, @messages, @messageCount, @systemEventCount,
                 @participants, @from, @to, @createdAt)`,
        )
        .run({
          id: rec.id,
          source: rec.source,
          format: rec.format,
          messages: JSON.stringify(rec.messages),
          messageCount: rec.messageCount,
          systemEventCount: rec.systemEventCount,
          participants: JSON.stringify(rec.participants),
          from: rec.period?.from ?? null,
          to: rec.period?.to ?? null,
          createdAt: rec.createdAt,
        });
      return rec;
    });
  }

  getSession(id: string): Promise<SessionRecord | null> {
    return this.task(() => {
      const row = this.db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(id) as SessionRow | undefined;
      return row ? this.toSession(row) : null;
    });
  }

  analysisIdsForSession(id: string): Promise<string[]> {
    return this.task(() => {
      const rows = this.db
        .prepare(
          'SELECT analysis_id FROM analysis_sessions WHERE session_id = ? ORDER BY rowid',
        )
        .all(id) as { analysis_id: string }[];
      return rows.map((r) => r.analysis_id);
    });
  }

  deleteSession(id: string): Promise<boolean> {
    return this.task(() => {
      const r = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return r.changes > 0;
    });
  }

  private toSession(r: SessionRow): SessionRecord {
    return {
      id: r.id,
      source: r.source as SessionSource,
      format: r.format as SessionFormat,
      messages: JSON.parse(r.messages_json) as ChatMessage[],
      messageCount: r.message_count,
      systemEventCount: r.system_event_count,
      participants: JSON.parse(
        r.participants_json,
      ) as SessionRecord['participants'],
      period:
        r.period_from && r.period_to
          ? { from: r.period_from, to: r.period_to }
          : null,
      createdAt: r.created_at,
    };
  }

  // ── 분석 ─────────────────────────────────────────────────────────

  createAnalysis(a: NewAnalysis): Promise<AnalysisRecord> {
    return this.task(() => {
      const rec: AnalysisRecord = {
        ...a,
        id: newId('ana'),
        status: 'running',
        error: null,
        patterns: [],
        summary: null,
        precedents: {},
        createdAt: now(),
        finishedAt: null,
      };
      const insertAnalysis = this.db.prepare(
        `INSERT INTO analyses (id, context, victim_name, participant_count, status, created_at)
       VALUES (?, ?, ?, ?, 'running', ?)`,
      );
      const insertLink = this.db.prepare(
        'INSERT INTO analysis_sessions (analysis_id, session_id, ord) VALUES (?, ?, ?)',
      );
      this.db.transaction(() => {
        insertAnalysis.run(
          rec.id,
          rec.context,
          rec.victimName,
          rec.participantCount,
          rec.createdAt,
        );
        rec.sessionIds.forEach((sid, i) => insertLink.run(rec.id, sid, i));
      })();
      return rec;
    });
  }

  completeAnalysis(id: string, o: AnalysisOutcome): Promise<void> {
    return this.task(() => {
      const update = this.db.prepare(
        `UPDATE analyses SET status = 'done', error = NULL, patterns_json = ?, summary_json = ?,
              precedents_json = ?, finished_at = ? WHERE id = ?`,
      );
      const clear = this.db.prepare(
        'DELETE FROM utterances WHERE analysis_id = ?',
      );
      const insert = this.db.prepare(
        `INSERT INTO utterances (id, analysis_id, session_id, seq, message_nos_json, harm_types_json,
                               severity, reason, applied_precedent_ids_json, excluded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      this.db.transaction(() => {
        update.run(
          JSON.stringify(o.patterns),
          JSON.stringify(o.summary),
          JSON.stringify(o.precedents),
          now(),
          id,
        );
        clear.run(id);
        for (const u of o.utterances) {
          insert.run(
            newId('utt'),
            id,
            u.sessionId,
            u.seq,
            JSON.stringify(u.messageNos),
            JSON.stringify(u.harmTypes),
            u.severity,
            u.reason,
            JSON.stringify(u.appliedPrecedentIds),
            u.excluded ? 1 : 0,
          );
        }
      })();
      return;
    });
  }

  failAnalysis(id: string, error: string): Promise<void> {
    return this.task(() => {
      this.db
        .prepare(
          `UPDATE analyses SET status = 'error', error = ?, finished_at = ? WHERE id = ?`,
        )
        .run(error, now(), id);
      return;
    });
  }

  getAnalysis(id: string): Promise<AnalysisWithUtterances | null> {
    return this.task(() => {
      const row = this.db
        .prepare('SELECT * FROM analyses WHERE id = ?')
        .get(id) as AnalysisRow | undefined;
      if (!row) return null;
      const utterances = (
        this.db
          .prepare(
            'SELECT * FROM utterances WHERE analysis_id = ? ORDER BY seq',
          )
          .all(id) as UtteranceRow[]
      ).map((u) => this.toUtterance(u));
      return { ...this.toAnalysis(row), utterances };
    });
  }

  listAnalyses(limit: number, offset: number): Promise<AnalysisListItem[]> {
    return this.task(() => {
      const rows = this.db
        .prepare(
          `SELECT a.*,
                (SELECT COUNT(*) FROM utterances u WHERE u.analysis_id = a.id) AS utterance_count,
                (SELECT COUNT(*) FROM utterances u WHERE u.analysis_id = a.id AND u.severity = '즉시조치') AS urgent_count
         FROM analyses a
         ORDER BY a.created_at DESC, a.rowid DESC
         LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as (AnalysisRow & {
        utterance_count: number;
        urgent_count: number;
      })[];
      return rows.map((r) => ({
        ...this.toAnalysis(r),
        utteranceCount: r.utterance_count,
        urgentCount: r.urgent_count,
      }));
    });
  }

  deleteAnalysis(id: string): Promise<boolean> {
    return this.task(() => {
      const r = this.db.prepare('DELETE FROM analyses WHERE id = ?').run(id);
      return r.changes > 0;
    });
  }

  private sessionIdsOf(analysisId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT session_id FROM analysis_sessions WHERE analysis_id = ? ORDER BY ord',
        )
        .all(analysisId) as { session_id: string }[]
    ).map((r) => r.session_id);
  }

  private toAnalysis(r: AnalysisRow): AnalysisRecord {
    return {
      id: r.id,
      sessionIds: this.sessionIdsOf(r.id),
      context: r.context as ChatContext,
      victimName: r.victim_name,
      participantCount: r.participant_count,
      status: r.status as AnalysisStatus,
      error: r.error,
      patterns: JSON.parse(r.patterns_json) as string[],
      summary: r.summary_json ? (JSON.parse(r.summary_json) as Summary) : null,
      precedents: JSON.parse(r.precedents_json) as Record<string, string>,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    };
  }

  private toUtterance(u: UtteranceRow): UtteranceRecord {
    return {
      id: u.id,
      analysisId: u.analysis_id,
      sessionId: u.session_id,
      seq: u.seq,
      messageNos: JSON.parse(u.message_nos_json) as number[],
      harmTypes: JSON.parse(u.harm_types_json) as string[],
      severity: u.severity,
      reason: u.reason,
      appliedPrecedentIds: JSON.parse(u.applied_precedent_ids_json) as string[],
      excluded: u.excluded === 1,
    };
  }
}
