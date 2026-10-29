/**
 * 세션 → 분석 → 조회 → PDF 전체 흐름. AI 엔진(analyze)만 스텁으로 바꾸고
 * 저장소는 PostgreSQL 임시 스키마, PDF 생성기는 스텁이다.
 *
 * UsersModule의 실제 세션 인증과 PostgreSQL 저장소를 사용한다.
 * 외부 AI·판례 매칭만 대체하고 두 사용자의 소유권 차단을 HTTP로 검증한다.
 */
import { createHash } from 'node:crypto';
import { UsersModule } from '../src/users/users.module';
import { Test, TestingModule } from '@nestjs/testing';
import { Global, Injectable, INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { buildValidationPipe } from './../src/validation-pipe';
import { SafeguardModule } from './../src/safeguard/safeguard.module';
import { SafeguardInfraModule } from './../src/safeguard/safeguard-infra.module';
import {
  NoopPrecedentProvider,
  PRECEDENT_PROVIDER,
} from './../src/safeguard/precedent-provider';
import { SAFEGUARD_STORE } from './../src/safeguard/storage/safeguard-store';
import { PostgresSafeguardStore } from './../src/safeguard/storage/postgres-safeguard-store';
import { openTestDatabase } from './postgres-test-db';
import { ActionsModule } from '../src/actions/actions.module';
import { ChatsModule } from '../src/chats/chats.module';
import { ChatLlmService } from '../src/chats/chat-llm.service';
import { SafeguardAnalysisService } from './../src/safeguard/safeguard-analysis.service';
import { AnalysesService } from './../src/safeguard/analyses.service';
import {
  ReportPdfService,
  type ReportInput,
} from './../src/safeguard/report-pdf.service';

jest.setTimeout(60_000);

const RAW = [
  '2학년 3반 단톡 님과 카카오톡 대화',
  '저장한 날짜 : 2026-03-20 21:14:03',
  '',
  '--------------- 2026년 3월 4일 수요일 ---------------',
  '[민준] [오후 7:12] 야 윤아 빵 사와라',
  '[지호] [오후 7:13] ㅋㅋㅋ',
  '[윤아] [오후 7:14] 싫어',
  '[민준] [오후 7:15] 안사오면 어떻게 되는지 알지',
].join('\n');

/** 스텁 엔진: 4번 메시지를 협박으로 판정한 것처럼 돌려준다 */
const STUB_RESULT = {
  flagged: [
    {
      messageNos: [1, 4],
      harmTypes: ['갈취강요', '협박'],
      severity: '즉시조치',
      reason: '금품 요구와 해악 고지',
      appliedPrecedentIds: ['2003도709'],
    },
  ],
  patterns: ['셔틀'],
  trace: {
    screening: { segments: [], patterns: ['셔틀'] },
    matched: {
      precedentDict: { '2003도709': '공갈', '2006도546': '협박(미사용)' },
      analysisTargets: [],
    },
  },
};

describe('Safeguard API (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let db: DataSource;
  let close: (() => Promise<void>) | undefined;
  let generatePdf: jest.SpyInstance<Promise<Buffer>, [ReportInput]>;

  beforeAll(async () => {
    const opened = await openTestDatabase();
    close = opened.close;
    db = opened.db;
    const store = new PostgresSafeguardStore(opened.db);

    @Global()
    @Module({
      providers: [{ provide: DataSource, useValue: opened.db }],
      exports: [DataSource],
    })
    class TestDatabaseModule {}

    // 매칭은 하지 않지만, 문서 생성이 참고 판례 상세를 어댑터에서 가져오는지는 본다
    class StubPrecedentProvider extends NoopPrecedentProvider {
      describe(ids: string[]) {
        return Promise.resolve(
          ids
            .filter((id) => id === '2003도709')
            .map((id) => ({
              id,
              caseNumber: '2003도709',
              court: '대법원',
              caseName: '공갈',
              decidedOn: '2003-05-13',
              summary: '공갈죄의 수단으로서 협박의 의미',
              refLaws: '형법 제350조',
              quotedTexts: [],
              rulings: [],
            })),
        );
      }
    }

    @Module({
      providers: [
        { provide: SAFEGUARD_STORE, useValue: store },
        { provide: PRECEDENT_PROVIDER, useClass: StubPrecedentProvider },
      ],
      exports: [SAFEGUARD_STORE, PRECEDENT_PROVIDER],
    })
    class TestInfraModule {}

    // 다른 모듈(행동 제시 카드 등)이 분석 결과를 읽을 수 있어야 한다 —
    // SafeguardModule 이 AnalysesService 를 export 하지 않으면 여기서 컴파일이 실패한다
    @Injectable()
    class OutsideConsumer {
      constructor(readonly analyses: AnalysesService) {}
    }
    @Module({ imports: [SafeguardModule], providers: [OutsideConsumer] })
    class OutsideModule {}

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TestDatabaseModule,
        UsersModule,
        SafeguardModule,
        OutsideModule,
        ActionsModule,
        ChatsModule,
      ],
    })
      .overrideModule(SafeguardInfraModule)
      .useModule(TestInfraModule)
      .overrideProvider(ChatLlmService)
      .useValue({
        reply: jest
          .fn()
          .mockResolvedValue({ reply: '테스트 상담 답변', isCrisis: false }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    owner = request.agent(app.getHttpServer());
    other = request.agent(app.getHttpServer());
    for (const [client, email, nickName] of [
      [owner, 'owner@test.com', 'owner'],
      [other, 'other@test.com', 'other'],
    ] as const) {
      await client.post('/auth/signup').send({ email, nickName }).expect(201);
      await client.post('/auth/login').send({ email }).expect(200);
    }

    // jest(CommonJS)는 puppeteer(ESM) 동적 import 를 못 한다 — PDF 생성기만 스텁, 라우트·헤더는 실제
    generatePdf = jest
      .spyOn(app.get(ReportPdfService), 'generate')
      .mockResolvedValue(Buffer.from('%PDF-1.4 stub'));

    const engine = app.get(SafeguardAnalysisService);
    jest.spyOn(engine, 'analyze').mockImplementation((_input, opts) => {
      opts?.onStage?.('screen');
      opts?.onStage?.('judge_done', { flagged: 1 });
      return Promise.resolve(STUB_RESULT as never);
    });
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await close?.();
    }
  });

  it('인증 없는 기능 요청과 만료·변조 세션은 401', async () => {
    const anonymous = request(app.getHttpServer());
    for (const path of [
      '/',
      '/analyses',
      '/analyses/unknown',
      '/analyses/unknown/report',
      '/analyses/unknown/actions',
      '/sessions/unknown',
    ]) {
      await anonymous.get(path).expect(401);
    }
    for (const path of [
      '/sessions',
      '/analyses',
      '/chats/intro',
      '/chats/messages',
    ]) {
      await anonymous.post(path).send({}).expect(401);
    }
    await anonymous.delete('/analyses/unknown').expect(401);
    await anonymous.delete('/sessions/unknown').expect(401);
    await anonymous
      .get('/analyses')
      .set('Cookie', 'hungry.sid=bad')
      .expect(401);
    await db.query(
      `INSERT INTO user_sessions (token_hash,user_id,expires_at)
      SELECT $1,id,now()-interval '1 day' FROM users WHERE email='owner@test.com'`,
      [createHash('sha256').update('b'.repeat(64)).digest('hex')],
    );
    await anonymous
      .get('/analyses')
      .set('Cookie', `hungry.sid=${'b'.repeat(64)}`)
      .expect(401);
  });

  it('로그아웃 후 같은 쿠키로 접근할 수 없다', async () => {
    const client = request.agent(app.getHttpServer());
    const login = await client
      .post('/auth/login')
      .send({ email: 'other@test.com' })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    await client.post('/auth/logout').expect(204);
    await request(app.getHttpServer())
      .get('/analyses')
      .set('Cookie', cookies.map((c) => c.split(';')[0]).join(';'))
      .expect(401);
  });

  it('소유자 없는 기존 자료·분석·상담은 누구에게도 노출되지 않는다', async () => {
    const upload = await owner
      .post('/sessions')
      .send({ rawText: RAW })
      .expect(201);
    const sid = (upload.body as { sessionId: string }).sessionId;
    const stream = await owner
      .post('/analyses')
      .send({ sessionIds: [sid], context: 'small_group', victimName: '윤아' })
      .expect(201);
    const result = JSON.parse(stream.text.trim().split('\n').at(-1)!) as {
      analysisId: string;
    };
    const aid = result.analysisId;
    const intro = await owner
      .post('/chats/intro')
      .send({ analysisId: aid })
      .expect(200);
    const cid = (intro.body as { sessionId: string }).sessionId;
    await db.query(
      'UPDATE safeguard_sessions SET user_id = NULL WHERE id = $1',
      [sid],
    );
    await db.query(
      'UPDATE safeguard_analyses SET user_id = NULL WHERE id = $1',
      [aid],
    );
    for (const client of [owner, other]) {
      await client.get(`/sessions/${sid}`).expect(404);
      await client.get(`/analyses/${aid}`).expect(404);
      await client.get(`/analyses/${aid}/report`).expect(404);
      await client.get(`/analyses/${aid}/actions`).expect(404);
      await client.delete(`/sessions/${sid}`).expect(404);
      await client.delete(`/analyses/${aid}`).expect(404);
      await client.post('/chats/intro').send({ analysisId: aid }).expect(404);
      await client
        .post('/chats/messages')
        .send({ sessionId: cid, userMessage: '접근' })
        .expect(404);
      const list = await client.get('/analyses').expect(200);
      expect(
        (list.body as { analyses: { analysisId: string }[] }).analyses.map(
          (a) => a.analysisId,
        ),
      ).not.toContain(aid);
    }
  });

  it('GET / — UI 페이지를 서빙한다', () => {
    return owner.get('/').expect(200).expect('Content-Type', /html/);
  });

  describe('sessions', () => {
    it('POST — 파싱 불가 원문은 400', () => {
      return owner
        .post('/sessions')
        .send({ rawText: '아무 형식도 아닌 텍스트' })
        .expect(400);
    });

    it('POST → GET → DELETE', async () => {
      const created = await owner
        .post('/sessions')
        .send({ rawText: RAW })
        .expect(201);
      expect(created.body).toMatchObject({
        format: 'kakao_pc',
        messageCount: 4,
        systemEventCount: 0,
        participants: [
          { name: '민준', messageCount: 2 },
          { name: '지호', messageCount: 1 },
          { name: '윤아', messageCount: 1 },
        ],
        period: { from: '2026-03-04T19:12', to: '2026-03-04T19:15' },
        analysisIds: [],
      });
      const id = (created.body as { sessionId: string }).sessionId;
      expect(id).toMatch(/^ses_/);

      const got = await owner.get(`/sessions/${id}`).expect(200);
      expect((got.body as { sessionId: string }).sessionId).toBe(id);
      expect(got.body).not.toHaveProperty('messages');

      await owner.delete(`/sessions/${id}`).expect(204);
      await owner.get(`/sessions/${id}`).expect(404);
    });
  });

  describe('analyses', () => {
    let sessionId: string;
    beforeAll(async () => {
      const r = await owner.post('/sessions').send({ rawText: RAW });
      sessionId = (r.body as { sessionId: string }).sessionId;
    });

    it('POST — 잘못된 context는 400 (스트림 열기 전), message는 노션 명세의 한 문장', async () => {
      const res = await owner
        .post('/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'invalid',
          victimName: '윤아',
        })
        .expect(400);
      expect((res.body as { message: unknown }).message).toBe(
        'context는 dm | small_group | large_group | public 중 하나',
      );
    });

    it('POST — 없는 세션은 404, 참여자가 아닌 피해자는 400', async () => {
      await owner
        .post('/analyses')
        .send({ sessionIds: ['ses_none'], context: 'dm', victimName: '윤아' })
        .expect(404);
      await owner
        .post('/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'dm',
          victimName: '없는사람',
        })
        .expect(400);
    });

    it('AI 실패는 스트림 error와 DB error 상태로 남고 PDF와 상담은 409', async () => {
      jest
        .spyOn(app.get(SafeguardAnalysisService), 'analyze')
        .mockRejectedValueOnce(new Error('test AI unavailable'));
      const res = await owner
        .post('/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'small_group',
          victimName: '윤아',
        })
        .expect(201);
      const lines = res.text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const last = lines[lines.length - 1];
      expect(last).toMatchObject({
        type: 'error',
        message: 'test AI unavailable',
      });
      const id = last.analysisId as string;
      const saved = await owner.get(`/analyses/${id}`).expect(200);
      expect(saved.body).toMatchObject({
        status: 'error',
        error: 'test AI unavailable',
      });
      await owner.get(`/analyses/${id}/report`).expect(409);
      await owner.post('/chats/intro').send({ analysisId: id }).expect(409);
      await owner.delete(`/analyses/${id}`).expect(204);
    });

    it('POST 스트리밍 → GET → 목록 → 세션 삭제 409 → PDF → DELETE', async () => {
      const res = await owner
        .post('/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'small_group',
          victimName: '윤아',
        })
        .expect(201)
        .expect('Content-Type', /x-ndjson/);
      const lines = res.text
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(lines[0]).toEqual({ type: 'stage', stage: 'screen' });
      const result = lines[lines.length - 1];
      expect(result.type).toBe('result');
      const analysisId = result.analysisId as string;
      expect(analysisId).toMatch(/^ana_/);
      expect(result).toMatchObject({
        status: 'done',
        sessionIds: [sessionId],
        context: 'small_group',
        participantCount: 3,
        victimName: '윤아',
        patterns: ['셔틀'],
        precedents: { '2003도709': '공갈' }, // 미사용 후보(2006도546)는 빠진다
        // 갈취강요·협박 + 즉시조치 → 코드가 고른 행동 제시 카드 (action-rules.ts)
        actionIds: [
          'CARD_EMERGENCY_REPORT',
          'CARD_NO_RETALIATION',
          'CARD_BACKUP_EVIDENCE',
          'CARD_NO_LEAVE_CHATROOM',
          'CARD_NO_MONEY_TRANSFER',
          'CARD_NO_MEETING',
          'CARD_INFORM_ADULT',
        ],
        summary: {
          total: 1,
          urgentCount: 1,
          distinctDays: 1,
          isRepeated: false,
        },
      });
      const utterances = result.utterances as Record<string, unknown>[];
      expect(utterances).toHaveLength(1);
      expect(utterances[0]).toMatchObject({
        messageNos: [1, 4],
        harmTypes: ['갈취강요', '협박'],
        severity: '즉시조치',
        excluded: false,
        messages: [
          { no: 1, sender: '민준', text: '야 윤아 빵 사와라' },
          { no: 4, sender: '민준', text: '안사오면 어떻게 되는지 알지' },
        ],
      });
      expect(utterances[0].utteranceId).toMatch(/^utt_/);

      const got = await owner.get(`/analyses/${analysisId}`).expect(200);
      expect(got.body).toEqual(
        result.type === 'result' ? { ...result, type: undefined } : {},
      );

      const list = await owner.get('/analyses?limit=5').expect(200);
      // 노션 명세: 배열을 그대로 주지 않고 { analyses: [...] } 로 감싼다
      const { analyses } = list.body as { analyses: unknown[] };
      expect(Array.isArray(list.body)).toBe(false);
      expect(analyses[0]).toMatchObject({
        analysisId,
        status: 'done',
        utteranceCount: 1,
        urgentCount: 1,
        patterns: ['셔틀'],
      });

      const cards = await owner
        .get(`/analyses/${analysisId}/actions`)
        .expect(200);
      expect(
        (cards.body as { actions: { id: string }[] }).actions.map((a) => a.id),
      ).toEqual(result.actionIds);

      const intro = await owner
        .post('/chats/intro')
        .send({ analysisId })
        .expect(200);
      const chatId = (intro.body as { sessionId: string }).sessionId;
      expect(chatId).toMatch(/^[a-f0-9-]{36}$/);
      const otherList = await other.get('/analyses').expect(200);
      expect(otherList.body).toEqual({ analyses: [] });
      for (const path of [
        `/sessions/${sessionId}`,
        `/analyses/${analysisId}`,
        `/analyses/${analysisId}/report`,
        `/analyses/${analysisId}/actions`,
      ]) {
        await other.get(path).expect(404);
      }
      await other.delete(`/sessions/${sessionId}`).expect(404);
      await other.delete(`/analyses/${analysisId}`).expect(404);
      await other
        .post('/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'small_group',
          victimName: '윤아',
        })
        .expect(404);
      await other.post('/chats/intro').send({ analysisId }).expect(404);
      await other
        .post('/chats/messages')
        .send({ sessionId: chatId, userMessage: '타인의 상담 접근' })
        .expect(404);
      await owner
        .post('/sessions')
        .send({ rawText: RAW, userId: 'forged-owner' })
        .expect(400);
      await owner
        .post('/chats/messages')
        .send({ sessionId: chatId, userMessage: '친구 때문에 속상해요' })
        .expect(200)
        .expect({
          reply: '테스트 상담 답변',
          isCrisis: false,
          emergencyContacts: null,
          fallback: false,
        });

      const conflict = await owner.delete(`/sessions/${sessionId}`).expect(409);
      expect((conflict.body as { analysisIds: string[] }).analysisIds).toEqual([
        analysisId,
      ]);

      const session = await owner.get(`/sessions/${sessionId}`).expect(200);
      expect((session.body as { analysisIds: string[] }).analysisIds).toEqual([
        analysisId,
      ]);

      const pdf = await owner
        .get(`/analyses/${analysisId}/report`)
        .buffer()
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200)
        .expect('Content-Type', /pdf/);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      // 문서는 한 종류 — legal 구분 없이, 구간이 참고한 판례 상세를 같이 넘긴다
      const lastCall = generatePdf.mock.calls.at(-1)?.[0] as unknown as Record<
        string,
        unknown
      >;
      expect(lastCall).not.toHaveProperty('legal');
      expect(lastCall.precedents).toEqual([
        expect.objectContaining({ id: '2003도709', caseNumber: '2003도709' }),
      ]);

      await owner.delete(`/analyses/${analysisId}`).expect(204);
      await owner.delete(`/analyses/${analysisId}`).expect(404);
      await owner
        .post('/chats/messages')
        .send({ sessionId: chatId, userMessage: '삭제 후 요청' })
        .expect(404);
      await owner.get(`/analyses/${analysisId}/actions`).expect(404);
      await owner.get(`/analyses/${analysisId}`).expect(404);
      await owner.get(`/analyses/${analysisId}/report`).expect(404);
      await owner.delete(`/sessions/${sessionId}`).expect(204);
    }, 60_000);
  });
});
