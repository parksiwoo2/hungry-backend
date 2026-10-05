/**
 * 저장소 계약 테스트 — SafeguardStore 구현이 모두 같은 동작을 하는지 본다.
 *
 * SQLite(메모리)는 항상 돈다. Postgres 는 실제 DB가 있어야 해서
 * SAFEGUARD_TEST_PG_URL 이 있을 때만 돈다 (없으면 skip):
 *   SAFEGUARD_TEST_PG_URL=postgres://postgres:pw@localhost:5432/hungry npm test
 * 전용 스키마(safeguard_test)를 만들었다 지우므로 다른 테이블은 건드리지 않는다.
 */
import { DataSource } from 'typeorm';
import { CreateSafeguardTables20261005000000 } from '../../migrations/20261005000000-create-safeguard-tables';
import { PostgresSafeguardStore } from './postgres-safeguard-store';
import { SqliteSafeguardStore } from './sqlite-safeguard-store';
import type { NewSession, SafeguardStore } from './safeguard-store';

const session = (): NewSession => ({
  source: 'kakao_export',
  format: 'kakao_pc',
  messages: [
    { sender: '갑', time: '2026-01-01T10:00', text: '야' },
    { sender: '을', time: '2026-01-01T10:01', text: '왜' },
  ],
  messageCount: 2,
  systemEventCount: 0,
  participants: [
    { name: '갑', messageCount: 1 },
    { name: '을', messageCount: 1 },
  ],
  period: { from: '2026-01-01T10:00', to: '2026-01-01T10:01' },
});

interface Opened {
  store: SafeguardStore;
  close: () => Promise<void>;
}

const PG_URL = process.env.SAFEGUARD_TEST_PG_URL;
const PG_SCHEMA = 'safeguard_test';

const openSqlite = (): Promise<Opened> => {
  const store = new SqliteSafeguardStore(':memory:');
  return Promise.resolve({
    store,
    close: () => Promise.resolve(store.onModuleDestroy()),
  });
};

/** 빈 스키마에 실제 마이그레이션을 돌린다 — 마이그레이션 SQL 자체도 함께 검증된다 */
const openPostgres = async (): Promise<Opened> => {
  const admin = new DataSource({ type: 'postgres', url: PG_URL });
  await admin.initialize();
  await admin.query(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${PG_SCHEMA}`);
  await admin.destroy();

  const db = new DataSource({
    type: 'postgres',
    url: PG_URL,
    schema: PG_SCHEMA,
    extra: { options: `-c search_path=${PG_SCHEMA}` },
    migrations: [CreateSafeguardTables20261005000000],
  });
  await db.initialize();
  await db.runMigrations();
  return {
    store: new PostgresSafeguardStore(db),
    close: async () => {
      await db.query(`DROP SCHEMA ${PG_SCHEMA} CASCADE`);
      await db.destroy();
    },
  };
};

const IMPLEMENTATIONS: [string, () => Promise<Opened>, boolean][] = [
  ['SqliteSafeguardStore', openSqlite, true],
  ['PostgresSafeguardStore', openPostgres, !!PG_URL],
];

describe.each(IMPLEMENTATIONS)('%s', (_name, open, enabled) => {
  const maybe = enabled ? it : it.skip;
  let store: SafeguardStore;
  let close: () => Promise<void>;
  beforeEach(async () => {
    if (!enabled) return;
    ({ store, close } = await open());
  });
  afterEach(async () => {
    if (enabled) await close();
  });

  maybe('세션을 저장하고 그대로 읽는다', async () => {
    const s = await store.createSession(session());
    expect(s.id).toMatch(/^ses_[0-9a-f]{20}$/);
    const got = await store.getSession(s.id);
    expect(got).toEqual(s);
    expect(await store.getSession('ses_none')).toBeNull();
  });

  maybe('분석: running으로 만들고 완료하면 구간이 붙는다', async () => {
    const s = await store.createSession(session());
    const a = await store.createAnalysis({
      sessionIds: [s.id],
      context: 'dm',
      victimName: '을',
      participantCount: 2,
    });
    expect(a.status).toBe('running');
    expect(await store.analysisIdsForSession(s.id)).toEqual([a.id]);

    await store.completeAnalysis(a.id, {
      patterns: ['떼카'],
      summary: {
        count: 1,
        typeCounts: { 협박: 1 },
        urgentCount: 1,
        attackerCounts: { 갑: 1 },
        distinctDays: 1,
        isRepeated: false,
      },
      precedents: { '2006도546': '요지' },
      utterances: [
        {
          sessionId: s.id,
          seq: 0,
          messageNos: [1],
          harmTypes: ['협박'],
          severity: '즉시조치',
          reason: '해악 고지',
          appliedPrecedentIds: ['2006도546'],
          excluded: false,
        },
      ],
    });

    const got = await store.getAnalysis(a.id);
    expect(got?.status).toBe('done');
    expect(got?.sessionIds).toEqual([s.id]);
    expect(got?.utterances).toHaveLength(1);
    expect(got?.utterances[0]).toMatchObject({
      analysisId: a.id,
      messageNos: [1],
      harmTypes: ['협박'],
      excluded: false,
    });
    expect(got?.utterances[0].id).toMatch(/^utt_/);
    expect(got?.precedents).toEqual({ '2006도546': '요지' });

    const list = await store.listAnalyses(10, 0);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: a.id,
      utteranceCount: 1,
      urgentCount: 1,
    });
  });

  maybe(
    '실패 기록과 삭제 — 분석 삭제는 구간까지, 세션은 분석이 있으면 못 지운다',
    async () => {
      const s = await store.createSession(session());
      const a = await store.createAnalysis({
        sessionIds: [s.id],
        context: 'dm',
        victimName: '을',
        participantCount: 2,
      });
      await store.failAnalysis(a.id, 'API 키 없음');
      expect((await store.getAnalysis(a.id))?.status).toBe('error');

      // 분석이 세션을 참조하는 동안은 DB가 세션 삭제를 막는다
      await expect(store.deleteSession(s.id)).rejects.toThrow(/foreign key/i);

      expect(await store.deleteAnalysis(a.id)).toBe(true);
      expect(await store.getAnalysis(a.id)).toBeNull();
      expect(await store.analysisIdsForSession(s.id)).toEqual([]);
      expect(await store.deleteSession(s.id)).toBe(true);
      expect(await store.getSession(s.id)).toBeNull();
    },
  );

  maybe('목록은 최신순이고 limit·offset 으로 자른다', async () => {
    const s = await store.createSession(session());
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = await store.createAnalysis({
        sessionIds: [s.id],
        context: 'dm',
        victimName: '을',
        participantCount: 2,
      });
      ids.push(a.id);
    }
    const all = await store.listAnalyses(10, 0);
    expect(all.map((a) => a.id)).toEqual([...ids].reverse());
    expect(all[0]).toMatchObject({ utteranceCount: 0, urgentCount: 0 });
    expect((await store.listAnalyses(1, 1)).map((a) => a.id)).toEqual([ids[1]]);
    expect(await store.analysisIdsForSession(s.id)).toEqual(ids);
  });

  maybe('집계·판례 사전의 키 순서를 저장한 그대로 돌려준다', async () => {
    // 응답의 typeCounts·precedents 는 엔진이 만든 순서로 나가야 한다 (jsonb 는 키를 재정렬한다)
    const s = await store.createSession(session());
    const a = await store.createAnalysis({
      sessionIds: [s.id],
      context: 'dm',
      victimName: '을',
      participantCount: 2,
    });
    await store.completeAnalysis(a.id, {
      patterns: [],
      summary: {
        count: 2,
        start: '2026-01-01T10:00',
        end: '2026-01-01T10:01',
        typeCounts: { 집단따돌림: 1, 모욕: 1, 갈취강요: 1 },
        urgentCount: 0,
        attackerCounts: { 을: 1, 갑: 1 },
        distinctDays: 1,
        isRepeated: false,
      },
      precedents: { '2020도5813': 'ㄴ', '87도739': 'ㄱ' },
      utterances: [],
    });
    const got = await store.getAnalysis(a.id);
    expect(Object.keys(got?.summary?.typeCounts ?? {})).toEqual([
      '집단따돌림',
      '모욕',
      '갈취강요',
    ]);
    expect(Object.keys(got?.precedents ?? {})).toEqual([
      '2020도5813',
      '87도739',
    ]);
    expect(got?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });
});
