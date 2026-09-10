/**
 * 세션 → 분석 → 조회 → PDF 전체 흐름. AI 엔진(analyze)만 스텁으로 바꾸고
 * 저장소는 메모리 SQLite, PDF 생성기는 스텁(실제 PDF는 서버 수동 E2E로 확인).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { SAFEGUARD_STORE } from './../src/safeguard/storage/safeguard-store';
import { SqliteSafeguardStore } from './../src/safeguard/storage/sqlite-safeguard-store';
import { SafeguardAnalysisService } from './../src/safeguard/safeguard-analysis.service';
import { ReportPdfService } from './../src/safeguard/report-pdf.service';

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
  let store: SqliteSafeguardStore;

  beforeAll(async () => {
    store = new SqliteSafeguardStore(':memory:');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SAFEGUARD_STORE)
      .useValue(store)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    // jest(CommonJS)는 puppeteer(ESM) 동적 import 를 못 한다 — PDF 생성기만 스텁, 라우트·헤더는 실제
    jest
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
    await app.close();
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
        .post('/api/sessions')
        .send({ rawText: '아무 형식도 아닌 텍스트' })
        .expect(400);
    });

    it('POST → GET → DELETE', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/sessions')
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
        .get(`/api/sessions/${id}`)
        .expect(200);
      expect((got.body as { sessionId: string }).sessionId).toBe(id);
      expect(got.body).not.toHaveProperty('messages');

      await request(app.getHttpServer())
        .delete(`/api/sessions/${id}`)
        .expect(204);
      await request(app.getHttpServer()).get(`/api/sessions/${id}`).expect(404);
    });
  });

  describe('analyses', () => {
    let sessionId: string;
    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/sessions')
        .send({ rawText: RAW });
      sessionId = (r.body as { sessionId: string }).sessionId;
    });

    it('POST — 잘못된 context는 400 (스트림 열기 전)', () => {
      return request(app.getHttpServer())
        .post('/api/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'invalid',
          victimName: '윤아',
        })
        .expect(400);
    });

    it('POST — 없는 세션은 404, 참여자가 아닌 피해자는 400', async () => {
      await request(app.getHttpServer())
        .post('/api/analyses')
        .send({ sessionIds: ['ses_none'], context: 'dm', victimName: '윤아' })
        .expect(404);
      await request(app.getHttpServer())
        .post('/api/analyses')
        .send({
          sessionIds: [sessionId],
          context: 'dm',
          victimName: '없는사람',
        })
        .expect(400);
    });

    it('POST 스트리밍 → GET → 목록 → 세션 삭제 409 → PDF → DELETE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/analyses')
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
        .get(`/api/analyses/${analysisId}`)
        .expect(200);
      expect(got.body).toEqual(
        result.type === 'result' ? { ...result, type: undefined } : {},
      );

      const list = await request(app.getHttpServer())
        .get('/api/analyses?limit=5')
        .expect(200);
      expect((list.body as unknown[])[0]).toMatchObject({
        analysisId,
        utteranceCount: 1,
        urgentCount: 1,
        patterns: ['셔틀'],
      });

      const conflict = await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionId}`)
        .expect(409);
      expect((conflict.body as { analysisIds: string[] }).analysisIds).toEqual([
        analysisId,
      ]);

      const session = await request(app.getHttpServer())
        .get(`/api/sessions/${sessionId}`)
        .expect(200);
      expect((session.body as { analysisIds: string[] }).analysisIds).toEqual([
        analysisId,
      ]);

      const pdf = await request(app.getHttpServer())
        .get(`/api/analyses/${analysisId}/report`)
        .buffer()
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200)
        .expect('Content-Type', /pdf/);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

      await request(app.getHttpServer())
        .delete(`/api/analyses/${analysisId}`)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/analyses/${analysisId}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/analyses/${analysisId}/report`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionId}`)
        .expect(204);
    }, 60_000);
  });
});
