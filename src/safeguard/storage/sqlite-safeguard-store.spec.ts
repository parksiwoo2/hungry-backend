import { SqliteSafeguardStore } from './sqlite-safeguard-store';
import type { NewSession } from './safeguard-store';

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

describe('SqliteSafeguardStore', () => {
  let store: SqliteSafeguardStore;
  beforeEach(() => {
    store = new SqliteSafeguardStore(':memory:');
  });
  afterEach(() => store.onModuleDestroy());

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
    await expect(store.deleteSession(s.id)).rejects.toThrow(/FOREIGN KEY/);

    expect(await store.deleteAnalysis(a.id)).toBe(true);
    expect(await store.getAnalysis(a.id)).toBeNull();
    expect(await store.analysisIdsForSession(s.id)).toEqual([]);
    expect(await store.deleteSession(s.id)).toBe(true);
    expect(await store.getSession(s.id)).toBeNull();
  });
});
