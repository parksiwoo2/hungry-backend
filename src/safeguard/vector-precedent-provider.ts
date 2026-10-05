/**
 * 판례 매칭의 운영 구현 — 팀 판례 검색 모듈(src/precedent, pgvector)을 우리 계약으로 감싼다.
 *
 * 계약(precedent-provider.ts)과 검색 모듈 사이에서 맞추는 것:
 *   - 검색 모듈은 호출당 구간 10개 · targetText 5000자까지 받는다 → 나눠 호출하고 자른다.
 *   - 검색 모듈은 targetMessageId 를 받지 않는다 → 응답이 입력 순서를 지키므로 순서로 맞춘다.
 *   - 우리는 사건번호를 판례 ID로 쓴다 → 사건번호 없는 판례는 뺀다.
 *   - 검색 응답의 searchSummary·factPattern 은 AI가 쓴 문장이다. 2차 판단에 들어가는 요지는
 *     판례 API 원문이어야 하므로(지어낸 요지는 판단 전체를 오염시킨다) 저장된 판시사항·판결요지
 *     원문에서 사전을 만든다. 원문을 못 구한 판례는 뺀다.
 *
 * 검색이 실패하면(임베딩 API 키 없음·DB 장애 등) 경고만 남기고 빈 결과를 준다 —
 * 2차 판단은 판례 없이도 기준으로 판정하므로, 외부 장애가 분석 실패로 번지지 않게 한다.
 * 임계값은 두지 않는다. 무관한 판례를 버리는 것은 2차 프롬프트의 몫이다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrecedentMatchService } from '../precedent/search/precedent-match.service';
import { PrecedentStoreService } from '../precedent/storage/precedent-store.service';
import type { PrecedentMatch } from '../precedent/analysis/precedent-analysis.types';
import type {
  AnalysisTarget,
  PrecedentMatchInput,
  PrecedentMatchOutput,
  PrecedentProvider,
} from './precedent-provider';

/** 검색 모듈(PrecedentMatchService.validateRequest)의 입력 제한 */
const MAX_TARGETS_PER_CALL = 10;
const MAX_TARGET_TEXT = 5000;
const MAX_AUDIENCE = 100_000;
/** 사전 한 줄의 요지 길이 — 프로토타입 판례 풀(pipeline.mjs)과 같은 형식 */
const MAX_GIST = 200;

@Injectable()
export class VectorPrecedentProvider implements PrecedentProvider {
  private readonly logger = new Logger(VectorPrecedentProvider.name);

  constructor(
    private readonly matcher: PrecedentMatchService,
    private readonly store: PrecedentStoreService,
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
        if (!entry || ids.includes(entry.caseNumber)) continue;
        ids.push(entry.caseNumber);
        precedentDict[entry.caseNumber] ??= entry.line;
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
