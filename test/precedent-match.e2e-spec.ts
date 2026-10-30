/**
 * 판례 매칭(PrecedentMatchService) — 죄명 필터와 폴백.
 *
 * 사실 유사도만으로는 모욕 구간에 명예훼손 판례가 붙는다(데모 96구간 중 죄명 일치 39건).
 * 호출자가 crimeTypePattern 을 주면 crime_types 가 맞는 쟁점만 후보로 하고,
 * 그 결과가 비면 필터 없이 다시 찾는다(판례 없이 끝나는 것보다 낫다).
 */
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { openTestDatabase } from './postgres-test-db';
import { EnsurePrecedentSchema20260816000000 } from '../src/migrations/20260816000000-ensure-precedent-schema';
import { CreatePrecedentAnalyses20260816010000 } from '../src/migrations/20260816010000-create-precedent-analyses';
import { PrecedentMatchService } from '../src/precedents/search/precedent-match.service';
import type { OpenAiPrecedentService } from '../src/precedents/analysis/openai-precedent.service';

const unit = (i: number) => {
  const v = Array<number>(1536).fill(0);
  v[i] = 1;
  return v;
};

describe('PrecedentMatchService — 죄명 필터 (PostgreSQL/pgvector)', () => {
  let db: DataSource;
  let close: (() => Promise<void>) | undefined;
  let service: PrecedentMatchService;

  beforeAll(async () => {
    const opened = await openTestDatabase();
    close = opened.close;
    db = opened.db;
    const runner = db.createQueryRunner();
    try {
      await new EnsurePrecedentSchema20260816000000().up(runner);
      await new CreatePrecedentAnalyses20260816010000().up(runner);
    } finally {
      await runner.release();
    }
    // 100: 명예훼손, 질의와 거의 같은 벡터 / 200: 모욕, 조금 먼 벡터
    for (const [id, crime, vec] of [
      ['100', '정보통신망법 위반(명예훼손)', [0.9, 0.1]],
      ['200', '모욕죄', [0.6, 0.8]],
    ] as const) {
      await db.query(
        `INSERT INTO precedents (external_id, case_number, case_name, matched_categories, matched_queries)
         VALUES ($1, $2, $3, '{}', '{}')`,
        [id, `2026도${id}`, crime],
      );
      await db.query(
        `INSERT INTO precedent_analyses (precedent_id,status,source_content_hash,prompt_version,analysis_model,embedding_model)
         VALUES ($1,'complete','t','t','t','t')`,
        [id],
      );
      const issueId = randomUUID();
      await db.query(
        `INSERT INTO precedent_analysis_issues
         (id,precedent_id,issue_order,evidence_type,evidence_texts,fact_pattern,search_summary,keywords,crime_types)
         VALUES ($1,$2,1,'group_chat_message',ARRAY['발언'],'상황','요약','{}',$3)`,
        [issueId, id, [crime]],
      );
      await db.query(
        `INSERT INTO precedent_issue_findings
         (id,issue_id,finding_order,court_name,court_level,holding,evidence_assessment,evidence_accepted)
         VALUES ($1,$2,1,'법원','first_instance','판단','증거',true)`,
        [randomUUID(), issueId],
      );
      const v = unit(0).map((_, i) =>
        i === 0 ? vec[0] : i === 1 ? vec[1] : 0,
      );
      await db.query(
        `INSERT INTO precedent_issue_embeddings
         (issue_id,embedding_model,summary_content_hash,fact_content_hash,rule_content_hash,summary_embedding,fact_embedding,rule_embedding)
         VALUES ($1,'t','t','t','t',$2::vector,$2::vector,$2::vector)`,
        [issueId, `[${v.join(',')}]`],
      );
    }
    const openAi = {
      createEmbeddings: (inputs: string[]) =>
        Promise.resolve(inputs.map(() => unit(0))),
    } as unknown as OpenAiPrecedentService;
    service = new PrecedentMatchService(db, openAi);
  }, 30000);

  afterAll(async () => {
    await close?.();
  });

  const target = (crimeTypePattern?: string) => ({
    targetText: '야 돼지 꺼져',
    legalContext: {
      isGroupChat: true,
      audienceCount: 10,
      victimIdentifiable: true,
    },
    ...(crimeTypePattern ? { crimeTypePattern } : {}),
  });

  it('필터가 없으면 벡터 유사도 순 — 명예훼손 판례가 1위', async () => {
    const res = await service.findMatches({ analysisTargets: [target()] });
    expect(res.analysisTargets[0].matches.map((m) => m.precedentId)).toEqual([
      '100',
      '200',
    ]);
  });

  it('crimeTypePattern 이 있으면 죄명이 맞는 판례만 — 모욕 패턴이면 모욕 판례만', async () => {
    const res = await service.findMatches({
      analysisTargets: [target('모욕')],
    });
    expect(res.analysisTargets[0].matches.map((m) => m.precedentId)).toEqual([
      '200',
    ]);
  });

  it('필터에 맞는 판례가 없으면 필터 없이 다시 찾는다', async () => {
    const res = await service.findMatches({
      analysisTargets: [target('스토킹|불안감')],
    });
    expect(res.analysisTargets[0].matches.map((m) => m.precedentId)).toEqual([
      '100',
      '200',
    ]);
  });

  it('crimeTypePattern 이 문자열이 아니거나 200자를 넘으면 400', async () => {
    await expect(
      service.findMatches({ analysisTargets: [target('가'.repeat(201))] }),
    ).rejects.toThrow(/crimeTypePattern/);
  });
});
