import { PostgresSafeguardStore } from '../src/safeguard/storage/postgres-safeguard-store';
import type {
  NewSession,
  SafeguardStore,
} from '../src/safeguard/storage/safeguard-store';
import { openTestDatabase } from './postgres-test-db';

jest.setTimeout(30_000);

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

describe('PostgresSafeguardStore', () => {
  let store: SafeguardStore;
  let close: () => Promise<void>;
  beforeEach(async () => {
    const opened = await openTestDatabase();
    store = new PostgresSafeguardStore(opened.db);
    close = opened.close;
  });
  afterEach(async () => {
    if (close) await close();
  });

  it('세션을 저장하고 그대로 읽는다', async () => {
    const s = await store.createSession(session());
    expect(s.id).toMatch(/^ses_[0-9a-f]{20}$/);
    const got = await store.getSession(s.id);
    expect(got).toEqual(s);
    expect(await store.getSession('ses_none')).toBeNull();
  });

  it('분석: running으로 만들고 완료하면 구간이 붙는다', async () => {
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

  it('실패 기록과 삭제 — 분석 삭제는 구간까지, 세션은 분석이 있으면 못 지운다', async () => {
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
    await expect(store.deleteSession(s.id)).rejects.toHaveProperty(
      'driverError.code',
      expect.stringMatching(/^(23001|23503)$/),
    );

    expect(await store.deleteAnalysis(a.id)).toBe(true);
    expect(await store.getAnalysis(a.id)).toBeNull();
    expect(await store.analysisIdsForSession(s.id)).toEqual([]);
    expect(await store.deleteSession(s.id)).toBe(true);
    expect(await store.getSession(s.id)).toBeNull();
    expect(await store.deleteAnalysis(a.id)).toBe(false);
    expect(await store.deleteSession(s.id)).toBe(false);
  });

  it('목록은 최신순이고 limit·offset 으로 자른다', async () => {
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

  it('집계·판례 사전의 키 순서를 저장한 그대로 돌려준다', async () => {
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
