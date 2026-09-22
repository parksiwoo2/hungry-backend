/**
 * 저장소 계약 — 세션(업로드 자료) · 분석 · 의심 구간(utterance).
 *
 * 팀 데이터 모델(analysis > session > utterance)을 그대로 따른다.
 * 지금 구현은 SQLite(sqlite-safeguard-store.ts)이고, 팀 DB가 정해지면
 * 이 인터페이스를 구현한 클래스로 SAFEGUARD_STORE 프로바이더만 바꾸면 된다.
 * 그래서 전부 async다 — SQLite는 동기지만 계약은 비동기 DB 기준으로 맞췄다.
 */
import { randomUUID } from 'crypto';
import type {
  ChatContext,
  ChatMessage,
  Summary,
} from '../safeguard-analysis.service';

export const SAFEGUARD_STORE = Symbol('SAFEGUARD_STORE');

export type SessionSource = 'kakao_export';
export type SessionFormat =
  'kakao_pc' | 'kakao_mobile_dm' | 'kakao_mobile_group';

export interface Participant {
  name: string;
  messageCount: number;
}

export interface SessionRecord {
  id: string;
  source: SessionSource;
  format: SessionFormat;
  messages: ChatMessage[];
  messageCount: number;
  systemEventCount: number;
  participants: Participant[];
  period: { from: string; to: string } | null;
  createdAt: string;
}

export type NewSession = Omit<SessionRecord, 'id' | 'createdAt'>;

export interface UtteranceRecord {
  id: string;
  analysisId: string;
  sessionId: string;
  seq: number; // 분석 안 순서 (첫 메시지 번호 순)
  messageNos: number[];
  harmTypes: string[];
  severity: string;
  reason: string;
  appliedPrecedentIds: string[];
  excluded: boolean;
}

export type NewUtterance = Omit<UtteranceRecord, 'id' | 'analysisId'>;

export type AnalysisStatus = 'running' | 'done' | 'error';

export interface AnalysisRecord {
  id: string;
  sessionIds: string[];
  context: ChatContext;
  victimName: string;
  participantCount: number;
  status: AnalysisStatus;
  error: string | null;
  patterns: string[];
  summary: Summary | null;
  precedents: Record<string, string>;
  createdAt: string;
  finishedAt: string | null;
}

export type NewAnalysis = Pick<
  AnalysisRecord,
  'sessionIds' | 'context' | 'victimName' | 'participantCount'
>;

export interface AnalysisOutcome {
  patterns: string[];
  summary: Summary;
  precedents: Record<string, string>;
  utterances: NewUtterance[];
}

export interface AnalysisWithUtterances extends AnalysisRecord {
  utterances: UtteranceRecord[];
}

export interface AnalysisListItem extends AnalysisRecord {
  utteranceCount: number;
  urgentCount: number;
}

export interface SafeguardStore {
  createSession(s: NewSession): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  /** 세션을 쓰는 분석 ID들 — 삭제 충돌(409) 판단용 */
  analysisIdsForSession(id: string): Promise<string[]>;
  deleteSession(id: string): Promise<boolean>;

  createAnalysis(a: NewAnalysis): Promise<AnalysisRecord>;
  completeAnalysis(id: string, outcome: AnalysisOutcome): Promise<void>;
  failAnalysis(id: string, error: string): Promise<void>;
  getAnalysis(id: string): Promise<AnalysisWithUtterances | null>;
  listAnalyses(limit: number, offset: number): Promise<AnalysisListItem[]>;
  deleteAnalysis(id: string): Promise<boolean>;
}

/** ses_… / ana_… / utt_… — 접두사로 종류가 보이는 불투명 ID */
export function newId(prefix: 'ses' | 'ana' | 'utt'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
