/**
 * 세션 → 분석 → 조회 → PDF 전체 흐름. AI 엔진(analyze)만 스텁으로 바꾸고
 * 저장소는 PostgreSQL 임시 스키마, PDF 생성기는 스텁이다.
 *
 * AppModule 이 아니라 SafeguardModule 만 올린다 — AppModule 은 Postgres 연결이 있어야 뜬다.
 * 운영 인프라(Postgres 저장소 · 판례 벡터 검색)는 SafeguardInfraModule 한곳에 모여 있어
 * 그 모듈만 테스트용으로 갈아 끼우면 DB·외부 API 없이 라우트·검증·저장 흐름을 본다.
 */
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
  let close: (() => Promise<void>) | undefined;
  let generatePdf: jest.SpyInstance<Promise<Buffer>, [ReportInput]>;

  beforeAll(async () => {
    const opened = await openTestDatabase();
    close = opened.close;
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

  it('GET / — UI 페이지를 서빙한다', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);
  });

  describe('sessions', () => {
    it('POST — 파싱 불가 원문은 400', () => {
      return request(app.getHttpServer())
        .post('/sessions')
        .send({ rawText: '아무 형식도 아닌 텍스트' })
        .expect(400);
    });

    it('POST → GET → DELETE', async () => {
      const created = await request(app.getHttpServer())
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

      const got = await request(app.getHttpServer())
        .get(`/sessions/${id}`)
        .expect(200);
      expect((got.body as { sessionId: string }).sessionId).toBe(id);
      expect(got.body).not.toHaveProperty('messages');

      await request(app.getHttpServer()).delete(`/sessions/${id}`).expect(204);
      await request(app.getHttpServer()).get(`/sessions/${id}`).expect(404);
    });
  });

  describe('analyses', () => {
    let sessionId: string;
    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/sessions')
        .send({ rawText: RAW });
      sessionId = (r.body as { sessionId: string }).sessionId;
    });

    it('POST — 잘못된 context는 400 (스트림 열기 전), message는 노션 명세의 한 문장', async () => {
      const res = await request(app.getHttpServer())
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
      await request(app.getHttpServer())
        .post('/analyses')
        .send({ sessionIds: ['ses_none'], context: 'dm', victimName: '윤아' })
        .expect(404);
      await request(app.getHttpServer())
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
      const res = await request(app.getHttpServer())
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
      const saved = await request(app.getHttpServer())
        .get(`/analyses/${id}`)
        .expect(200);
      expect(saved.body).toMatchObject({
        status: 'error',
        error: 'test AI unavailable',
      });
      await request(app.getHttpServer())
        .get(`/analyses/${id}/report`)
        .expect(409);
      await request(app.getHttpServer())
        .post('/chats/intro')
        .send({ analysisId: id })
        .expect(409);
      await request(app.getHttpServer()).delete(`/analyses/${id}`).expect(204);
    });

    it('POST 스트리밍 → GET → 목록 → 세션 삭제 409 → PDF → DELETE', async () => {
      const res = await request(app.getHttpServer())
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

      const got = await request(app.getHttpServer())
        .get(`/analyses/${analysisId}`)
        .expect(200);
      expect(got.body).toEqual(
        result.type === 'result' ? { ...result, type: undefined } : {},
      );

      const list = await request(app.getHttpServer())
        .get('/analyses?limit=5')
        .expect(200);
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

      const cards = await request(app.getHttpServer())
        .get(`/analyses/${analysisId}/actions`)
        .expect(200);
      expect(
        (cards.body as { actions: { id: string }[] }).actions.map((a) => a.id),
      ).toEqual(result.actionIds);

      const intro = await request(app.getHttpServer())
        .post('/chats/intro')
        .send({ analysisId })
        .expect(200);
      const chatId = (intro.body as { sessionId: string }).sessionId;
      expect(chatId).toMatch(/^[a-f0-9-]{36}$/);
      await request(app.getHttpServer())
        .post('/chats/messages')
        .send({ sessionId: chatId, userMessage: '친구 때문에 속상해요' })
        .expect(200)
        .expect({
          reply: '테스트 상담 답변',
          isCrisis: false,
          emergencyContacts: null,
          fallback: false,
        });

      const conflict = await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .expect(409);
      expect((conflict.body as { analysisIds: string[] }).analysisIds).toEqual([
        analysisId,
      ]);

      const session = await request(app.getHttpServer())
        .get(`/sessions/${sessionId}`)
        .expect(200);
      expect((session.body as { analysisIds: string[] }).analysisIds).toEqual([
        analysisId,
      ]);

      const pdf = await request(app.getHttpServer())
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

      await request(app.getHttpServer())
        .delete(`/analyses/${analysisId}`)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/analyses/${analysisId}`)
        .expect(404);
      await request(app.getHttpServer())
        .post('/chats/messages')
        .send({ sessionId: chatId, userMessage: '삭제 후 요청' })
        .expect(404);
      await request(app.getHttpServer())
        .get(`/analyses/${analysisId}/actions`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/analyses/${analysisId}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/analyses/${analysisId}/report`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/sessions/${sessionId}`)
        .expect(204);
    }, 60_000);
  });
});
