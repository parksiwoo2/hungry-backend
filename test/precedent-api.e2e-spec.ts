import { createHash } from 'node:crypto';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../src/users/auth.guard';
import { SessionService } from '../src/users/session.service';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { openTestDatabase } from './postgres-test-db';
import { EnsurePrecedentSchema20260816000000 } from '../src/migrations/20260816000000-ensure-precedent-schema';
import { CreatePrecedentAnalyses20260816010000 } from '../src/migrations/20260816010000-create-precedent-analyses';
import { PrecedentsController } from '../src/precedents/precedents.controller';
import { PrecedentService } from '../src/precedents/external/precedent.service';
import { PrecedentHybridSearchService } from '../src/precedents/search/precedent-hybrid-search.service';
import { PrecedentMatchService } from '../src/precedents/search/precedent-match.service';
import { PrecedentStoreService } from '../src/precedents/storage/precedent-store.service';
import { PrecedentModelQueryService } from '../src/precedents/storage/precedent-model-query.service';
import { OpenAiPrecedentService } from '../src/precedents/analysis/openai-precedent.service';

describe('Precedent HTTP API with PostgreSQL/pgvector', () => {
  let app: INestApplication<App>;
  const token = 'a'.repeat(64);
  let client: ReturnType<typeof request.agent>;
  let close: (() => Promise<void>) | undefined;
  const embedding = [1, ...Array<number>(1535).fill(0)];
  const createEmbeddings = jest.fn().mockResolvedValue([embedding]);
  const httpGet = jest.fn();

  beforeAll(async () => {
    const opened = await openTestDatabase();
    close = opened.close;
    const db = opened.db;
    await db.query(
      "INSERT INTO users (id,email,nick_name) VALUES ($1,'search@test.com','search')",
      ['11111111-1111-4111-8111-111111111111'],
    );
    await db.query(
      "INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",
      [
        createHash('sha256').update(token).digest('hex'),
        '11111111-1111-4111-8111-111111111111',
      ],
    );
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
      controllers: [PrecedentsController],
      providers: [
        SessionService,
        { provide: APP_GUARD, useClass: AuthGuard },
        PrecedentService,
        PrecedentHybridSearchService,
        PrecedentModelQueryService,
        { provide: DataSource, useValue: db },
        { provide: ConfigService, useValue: { get: () => 'test' } },
        { provide: HttpService, useValue: { get: httpGet } },
        { provide: OpenAiPrecedentService, useValue: { createEmbeddings } },
        ...[PrecedentMatchService, PrecedentStoreService].map((provide) => ({
          provide,
          useValue: {},
        })),
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    client = request.agent(app.getHttpServer());
    client.set('Cookie', `hungry.sid=${token}`);
  }, 30000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await close?.();
    }
  });

  it('판례 기능도 로그인하지 않으면 401', async () => {
    for (const path of [
      '/precedents',
      '/precedents/228541',
      '/precedents/stored',
      '/precedents/stored/categories',
      '/precedents/stored/100',
      '/precedents/models/issues',
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    await request(app.getHttpServer())
      .post('/precedents/search')
      .send({ query: '모욕' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/precedents/match')
      .send({})
      .expect(401);
  });

  it('검색 SQL, 점수, 판례 중복 제거, 완료 상태 및 offset을 검증한다', async () => {
    const first = await client
      .post('/precedents/search')
      .send({ query: '단톡방 모욕', limit: 1 })
      .expect(201);
    expect(first.body).toMatchObject({
      results: [
        {
          precedentId: '100',
          issueOrder: 1,
          courtFindings: [{ evidenceAccepted: true }],
        },
      ],
    });
    expect(first.body).not.toHaveProperty('mode');
    expect(first.body).not.toHaveProperty('filters');
    const firstBody = first.body as { results: Record<string, unknown>[] };
    expect(firstBody.results[0]).not.toHaveProperty('score');
    const second = await client
      .post('/precedents/search')
      .send({ query: '단톡방 모욕', limit: 1, offset: 1 })
      .expect(201);
    expect(second.body).toMatchObject({ results: [{ precedentId: '200' }] });
    const end = await client
      .post('/precedents/search')
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
    await client.post('/precedents/search').send(body).expect(400);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('저장 판례와 쟁점별 법원 판단을 반환하고 외부 API는 호출하지 않는다', async () => {
    httpGet.mockClear();
    const result = await client.get('/precedents/100').expect(200);
    const body = result.body as Awaited<
      ReturnType<PrecedentModelQueryService['findDetail']>
    >;
    expect(Object.keys(body).sort()).toEqual(['issues', 'precedent']);
    expect(body.precedent).toMatchObject({
      externalId: '100',
      caseNumber: '2026도100',
    });
    expect(body.precedent).not.toHaveProperty('id');
    expect(body.issues).toHaveLength(2);
    expect(
      body.issues.map((issue: { issueOrder: number }) => issue.issueOrder),
    ).toEqual([1, 2]);
    for (const issue of body.issues as Array<{
      id: string;
      courtFindings: unknown[];
    }>) {
      expect(issue.courtFindings).toEqual([
        expect.objectContaining({
          issueId: issue.id,
          findingOrder: 1,
          evidenceAccepted: true,
        }),
      ]);
    }
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('숫자가 아닌 ID는 400, 없는 저장 판례는 404', async () => {
    await client.get('/precedents/not-a-number').expect(400);
    await client.get('/precedents/999999').expect(404);
  });
});
