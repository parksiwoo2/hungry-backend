/**
 * 판례 매칭의 운영 구현 — 팀 판례 검색 모듈(src/precedent, pgvector)을 우리 계약으로 감싼다.
 *
 * 계약(precedent-provider.ts)과 검색 모듈 사이에서 맞추는 것:
 *   - 검색 모듈은 호출당 구간 10개 · targetText 5000자까지 받는다 → 나눠 호출하고 자른다.
 *   - 검색 모듈은 targetMessageId 를 받지 않는다 → 응답이 입력 순서를 지키므로 순서로 맞춘다.
 *   - 판례 ID는 상세 조회 API와 같은 일련번호를 쓴다. 사건번호는 요지에 표시한다.
 *   - 검색 응답의 searchSummary·factPattern 은 AI가 쓴 문장이다. 2차 판단에 들어가는 요지는
 *     판례 API 원문이어야 하므로(지어낸 요지는 판단 전체를 오염시킨다) 저장된 판시사항·판결요지
 *     원문에서 사전을 만든다. 원문을 못 구한 판례는 뺀다.
 *
 * 검색이 실패하면(임베딩 API 키 없음·DB 장애 등) 경고만 남기고 빈 결과를 준다 —
 * 2차 판단은 판례 없이도 기준으로 판정하므로, 외부 장애가 분석 실패로 번지지 않게 한다.
 * 임계값은 두지 않는다. 무관한 판례를 버리는 것은 2차 프롬프트의 몫이다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PrecedentMatchService } from '../precedent/search/precedent-match.service';
import {
  PrecedentStoreService,
  type StoredPrecedentDetail,
} from '../precedent/storage/precedent-store.service';
import type { PrecedentMatch } from '../precedent/analysis/precedent-analysis.types';
import type {
  AnalysisTarget,
  PrecedentDetail,
  PrecedentMatchInput,
  PrecedentMatchOutput,
  PrecedentProvider,
  PrecedentIssueDetail,
} from './precedent-provider';

/** 검색 모듈(PrecedentMatchService.validateRequest)의 입력 제한 */
const MAX_TARGETS_PER_CALL = 10;
const MAX_TARGET_TEXT = 5000;
const MAX_AUDIENCE = 100_000;
/** 사전 한 줄의 요지 길이 — 프로토타입 판례 풀(pipeline.mjs)과 같은 형식 */
const MAX_GIST = 200;
/** 쟁점별로 문서에 싣는 인용 발언 개수 */
const MAX_QUOTES = 3;

/**
 * 팀 분석 테이블(precedent_analysis_issues ⋈ precedent_issue_findings) 한 행.
 * 팀 서비스에 조회 메서드가 없어 읽기 전용 SQL로 직접 본다.
 */
export interface IssueRow {
  precedent_id: string;
  issue_order: number;
  evidence_texts: string[];
  finding_order: number | null;
  court_name: string | null;
  is_guilty_recognized: boolean | null;
}

const ISSUE_SQL = `
  SELECT i.precedent_id, i.issue_order, i.evidence_texts,
         f.finding_order, f.court_name, f.is_guilty_recognized
  FROM precedent_analysis_issues i
  LEFT JOIN precedent_issue_findings f ON f.issue_id = i.id
  WHERE i.precedent_id = ANY($1)
  ORDER BY i.precedent_id, i.issue_order, f.finding_order`;

@Injectable()
export class VectorPrecedentProvider implements PrecedentProvider {
  private readonly logger = new Logger(VectorPrecedentProvider.name);

  constructor(
    private readonly matcher: PrecedentMatchService,
    private readonly store: PrecedentStoreService,
    private readonly db: DataSource,
  ) {}

  async match(input: PrecedentMatchInput): Promise<PrecedentMatchOutput> {
    try {
      return await this.search(input.analysisTargets);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`판례 검색 실패 — 판례 없이 진행: ${message}`);
      return {
        precedentDict: {},
        analysisTargets: input.analysisTargets.map((t) => ({
          ...t,
          matchedPrecedentIds: [],
        })),
      };
    }
  }

  async describe(ids: string[]): Promise<PrecedentDetail[]> {
    if (ids.length === 0) return [];
    try {
      const rows = await this.db.query<IssueRow[]>(ISSUE_SQL, [ids]);
      const out: PrecedentDetail[] = [];
      for (const id of ids) {
        const d = await this.detail(
          id,
          rows.filter((r) => r.precedent_id === id),
        );
        if (d) out.push(d);
      }
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `판례 상세 조회 실패 — 문서에 판례 없이 진행: ${message}`,
      );
      return [];
    }
  }

  /** 원문(저장소)과 결론·인용 발언(분석 테이블)을 합친다. 사건번호 없으면 null */
  private async detail(
    id: string,
    rows: IssueRow[],
  ): Promise<PrecedentDetail | null> {
    let stored: StoredPrecedentDetail;
    try {
      stored = await this.store.findOne(id);
    } catch {
      return null;
    }
    const caseNumber = stored.caseNumber?.trim();
    if (!caseNumber) return null;

    const source = stored.summary?.trim() || stored.gist?.trim() || '';
    const issues = new Map<number, PrecedentIssueDetail>();
    for (const r of rows) {
      let issue = issues.get(r.issue_order);
      if (!issue) {
        issue = { issueOrder: r.issue_order, quotedTexts: [], rulings: [] };
        issues.set(r.issue_order, issue);
      }
      for (const text of r.evidence_texts ?? []) {
        const quote = text.trim();
        if (
          quote &&
          !issue.quotedTexts.includes(quote) &&
          issue.quotedTexts.length < MAX_QUOTES
        )
          issue.quotedTexts.push(quote);
      }
      if (r.court_name?.trim())
        issue.rulings.push({
          court: r.court_name.trim(),
          guilty: r.is_guilty_recognized,
        });
    }

    return {
      id,
      caseNumber,
      court: stored.courtName?.trim() || null,
      caseName: stored.caseName?.trim() || null,
      decidedOn: formatDate(stored.judgementDate),
      summary: source ? firstItem(source) : null,
      refLaws: stored.refLaws?.trim() || null,
      issues: [...issues.values()].sort((a, b) => a.issueOrder - b.issueOrder),
    };
  }

  private async search(
    targets: AnalysisTarget[],
  ): Promise<PrecedentMatchOutput> {
    const hits = await this.findHits(targets);

    // 판례 일련번호 → 사건번호와 원문 요지. 같은 판례는 한 번만 조회한다
    const lines = new Map<
      string,
      { caseNumber: string; line: string } | null
    >();
    for (const m of hits.flat()) {
      if (lines.has(m.precedentId)) continue;
      lines.set(m.precedentId, await this.dictLine(m));
    }

    const precedentDict: Record<string, string> = {};
    const analysisTargets = targets.map((t, i) => {
      const ids: string[] = [];
      for (const m of hits[i]) {
        const entry = lines.get(m.precedentId);
        if (!entry || ids.includes(m.precedentId)) continue;
        ids.push(m.precedentId);
        precedentDict[m.precedentId] ??= entry.line;
      }
      return { ...t, matchedPrecedentIds: ids };
    });
    return { precedentDict, analysisTargets };
  }

  /** 구간마다의 검색 결과 (입력 순서). 본문이 빈 구간은 검색하지 않는다 */
  private async findHits(
    targets: AnalysisTarget[],
  ): Promise<PrecedentMatch[][]> {
    const hits: PrecedentMatch[][] = targets.map(() => []);
    const searchable = targets
      .map((t, index) => ({ index, text: t.targetText.trim(), t }))
      .filter((x) => x.text.length > 0);

    for (let i = 0; i < searchable.length; i += MAX_TARGETS_PER_CALL) {
      const chunk = searchable.slice(i, i + MAX_TARGETS_PER_CALL);
      const res = await this.matcher.findMatches({
        analysisTargets: chunk.map(({ text, t }) => ({
          targetText: text.slice(0, MAX_TARGET_TEXT),
          legalContext: {
            isGroupChat: t.legalContext.isGroupChat,
            audienceCount: Math.min(
              Math.max(0, Math.trunc(t.legalContext.audienceCount)),
              MAX_AUDIENCE,
            ),
            victimIdentifiable: t.legalContext.victimIdentifiable,
          },
        })),
      });
      chunk.forEach(({ index }, k) => {
        hits[index] = res.analysisTargets[k]?.matches ?? [];
      });
    }
    return hits;
  }

  /** "대법원 2003도709: 판시사항 첫 항목" — 사건번호나 원문 요지가 없으면 null */
  private async dictLine(
    m: PrecedentMatch,
  ): Promise<{ caseNumber: string; line: string } | null> {
    const caseNumber = m.caseNumber?.trim();
    if (!caseNumber) return null;
    let source: string;
    let court: string | null;
    try {
      const detail = await this.store.findOne(m.precedentId);
      source = detail.summary?.trim() || detail.gist?.trim() || '';
      court = detail.courtName;
    } catch {
      return null; // 저장소에 원문이 없는 판례
    }
    if (!source) return null;
    const head = [court?.trim(), caseNumber].filter(Boolean).join(' ');
    return { caseNumber, line: `${head}: ${firstItem(source)}` };
  }
}

/** 판시사항이 "[1] … [2] …" 꼴이면 첫 항목만. 공백을 접고 길이를 자른다 */
function firstItem(text: string): string {
  const m = text.match(/\[1\]([\s\S]*?)(?=\[2\]|$)/);
  return (m ? m[1] : text).replace(/\s+/g, ' ').trim().slice(0, MAX_GIST);
}

/** 법령 API의 선고일 "20220728" → "2022-07-28". 형식이 다르면 그대로 */
function formatDate(raw: string | null): string | null {
  const d = raw?.trim();
  if (!d) return null;
  const m = d.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : d;
}
