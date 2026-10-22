import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { openTestDatabase } from './postgres-test-db';
import { EnsurePrecedentSchema20260816000000 } from '../src/migrations/20260816000000-ensure-precedent-schema';
import { CreatePrecedentAnalyses20260816010000 } from '../src/migrations/20260816010000-create-precedent-analyses';
import { PrecedentController } from '../src/precedent/precedent.controller';
import { PrecedentService } from '../src/precedent/external/precedent.service';
import { PrecedentHybridSearchService } from '../src/precedent/search/precedent-hybrid-search.service';
import { PrecedentMatchService } from '../src/precedent/search/precedent-match.service';
import { PrecedentStoreService } from '../src/precedent/storage/precedent-store.service';
import { PrecedentModelQueryService } from '../src/precedent/storage/precedent-model-query.service';
import { OpenAiPrecedentService } from '../src/precedent/analysis/openai-precedent.service';

describe('Precedent HTTP API with PostgreSQL/pgvector', () => {
  let app: INestApplication<App>;
  let close: (() => Promise<void>) | undefined;
  const embedding = [1, ...Array<number>(1535).fill(0)];
  const createEmbeddings = jest.fn().mockResolvedValue([embedding]);
  const httpGet = jest.fn();

  beforeAll(async () => {
    const opened = await openTestDatabase();
    close = opened.close;
    const db = opened.db;
    const runner = db.createQueryRunner();
    try {
      await new EnsurePrecedentSchema20260816000000().up(runner);
      await new CreatePrecedentAnalyses20260816010000().up(runner);
    } finally {
      await runner.release();
    }
    for (const [id, status] of [
      ['100', 'complete'],
      ['200', 'complete'],
      ['300', 'pending'],
    ]) {
      await db.query(
        `INSERT INTO precedents (external_id, case_number, case_name, matched_categories, matched_queries)
        VALUES ($1, $2, '테스트 판례', '{}', '{}')`,
        [id, `2026도${id}`],
      );
      await db.query(
        `INSERT INTO precedent_analyses (precedent_id,status,source_content_hash,prompt_version,analysis_model,embedding_model)
        VALUES ($1,$2,'test','test','test','test')`,
        [id, status],
      );
      await db.query(
        `INSERT INTO precedent_search_documents (precedent_id,chunk_order,search_text)
        VALUES ($1,1,$2)`,
        [id, id === '100' ? '단톡방 모욕 공연성' : '기타'],
      );
      for (let order = 1; order <= (id === '100' ? 2 : 1); order++) {
        const issueId = randomUUID();
        const vector =
          id === '100' && order === 1
            ? embedding
            : [0, 1, ...Array<number>(1534).fill(0)];
        await db.query(
          `INSERT INTO precedent_analysis_issues
          (id,precedent_id,issue_order,evidence_type,evidence_texts,fact_pattern,search_summary,keywords)
          VALUES ($1,$2,$3,'chat_message',ARRAY['문제 발언'],'단톡방 발언','쟁점 요약',$4)`,
          [issueId, id, order, id === '100' ? ['모욕'] : []],
        );
        await db.query(
          `INSERT INTO precedent_issue_findings
          (id,issue_id,finding_order,court_name,court_level,holding,evidence_assessment,evidence_accepted)
          VALUES ($1,$2,1,'테스트 법원','first_instance','판단','증거 판단',true)`,
          [randomUUID(), issueId],
        );
        await db.query(
          `INSERT INTO precedent_issue_embeddings
          (issue_id,embedding_model,summary_content_hash,fact_content_hash,rule_content_hash,summary_embedding,fact_embedding,rule_embedding)
          VALUES ($1,'test','test','test','test',$2::vector,$2::vector,$2::vector)`,
          [issueId, `[${vector.join(',')}]`],
        );
      }
    }
    const module = await Test.createTestingModule({
      controllers: [PrecedentController],
      providers: [
        PrecedentService,
        PrecedentHybridSearchService,
        { provide: DataSource, useValue: db },
        { provide: ConfigService, useValue: { get: () => 'test' } },
        { provide: HttpService, useValue: { get: httpGet } },
        { provide: OpenAiPrecedentService, useValue: { createEmbeddings } },
        ...[
          PrecedentMatchService,
          PrecedentStoreService,
          PrecedentModelQueryService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await close?.();
    }
  });

  it('검색 SQL, 점수, 판례 중복 제거, 완료 상태 및 offset을 검증한다', async () => {
    const first = await request(app.getHttpServer())
      .post('/precedent/search')
      .send({ query: '단톡방 모욕', limit: 1 })
      .expect(201);
    expect(first.body).toMatchObject({
      results: [
        {
          precedentId: '100',
          issueOrder: 1,
          score: { vector: 1, keyword: 1, overall: 0.9 },
          courtFindings: [{ evidenceAccepted: true }],
        },
      ],
    });
    const second = await request(app.getHttpServer())
      .post('/precedent/search')
      .send({ query: '단톡방 모욕', limit: 1, offset: 1 })
      .expect(201);
    expect(second.body).toMatchObject({ results: [{ precedentId: '200' }] });
    const end = await request(app.getHttpServer())
      .post('/precedent/search')
      .send({ query: '단톡방 모욕', offset: 2 })
      .expect(201);
    expect(end.body).toMatchObject({ results: [] });
  });

  it.each([
    { query: '' },
    { query: '모욕', limit: 0 },
    { query: '모욕', offset: -1 },
  ])('잘못된 검색 입력은 400: %j', async (body) => {
    createEmbeddings.mockClear();
    await request(app.getHttpServer())
      .post('/precedent/search')
      .send(body)
      .expect(400);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('판례 상세의 외부 요청 인자와 본문 변환을 검증한다', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          PrecService: {
            판례정보일련번호: '228541',
            사건번호: '2021도3451',
            판례내용: '<p>판례 본문</p>',
          },
        },
      }),
    );
    const result = await request(app.getHttpServer())
      .get('/precedent/228541')
      .expect(200);
    expect(result.body).toMatchObject({
      id: '228541',
      fullContent: '판례 본문',
    });
    expect(httpGet).toHaveBeenCalledWith(
      expect.stringContaining('/lawService.do'),
      { params: { OC: 'test', target: 'prec', type: 'JSON', ID: 228541 } },
    );
  });

  it('숫자가 아닌 판례 ID는 400, 외부 통신 실패는 502', async () => {
    await request(app.getHttpServer())
      .get('/precedent/not-a-number')
      .expect(400);
    httpGet.mockReturnValue(
      throwError(() => new Error('upstream unavailable')),
    );
    await request(app.getHttpServer()).get('/precedent/228541').expect(502);
  });
});
