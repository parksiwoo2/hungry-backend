import type { AnalysisResponse } from '../safeguard/analyses.service';
import {
  INTRO_TRIGGER,
  buildSystemPrompt,
  hasCrisisKeyword,
  toLlmMessages,
} from './chat-prompt';

function analysis(): AnalysisResponse {
  return {
    analysisId: 'ana_1',
    status: 'done',
    error: null,
    createdAt: '2026-10-05T00:00:00Z',
    finishedAt: '2026-10-05T00:01:00Z',
    sessionIds: ['ses_1'],
    context: 'large_group',
    participantCount: 4,
    victimName: '윤아',
    patterns: ['셔틀'],
    precedents: {},
    actionIds: [],
    summary: {
      total: 2,
      urgentCount: 1,
      typeCounts: { 갈취강요: 1 },
      attackerCounts: { 민준: 3, 지호: 1 },
      distinctDays: 4,
      isRepeated: true,
      period: { from: '2026-03-04', to: '2026-03-20' },
    },
    utterances: [
      {
        utteranceId: 'utt_1',
        sessionId: 'ses_1',
        messageNos: [1],
        harmTypes: ['갈취강요'],
        severity: '주의',
        reason: '민준이 빵을 요구함',
        appliedPrecedentIds: [],
        excluded: false,
        messages: [],
      },
      {
        utteranceId: 'utt_2',
        sessionId: 'ses_1',
        messageNos: [4],
        harmTypes: ['협박'],
        severity: '즉시조치',
        reason: '지호가 해악을 고지함',
        appliedPrecedentIds: [],
        excluded: true, // 사용자가 제외한 구간
        messages: [],
      },
    ],
  };
}

describe('hasCrisisKeyword', () => {
  it.each([
    '죽고 싶어요',
    '죽 고 싶 다',
    '자해를 했어요',
    '그냥 사라지고 싶어',
    '극단적 선택 같은 생각이 들어요',
    '손목을 그으면 어떨까',
  ])('위기 표현을 잡는다: %s', (text) => {
    expect(hasCrisisKeyword(text)).toBe(true);
  });

  it.each([
    '내일 학교 가기가 무서워요',
    '걔네가 또 빵 사오라고 해요',
    '죽을 것 같이 불안해요', // 과장 표현은 LLM 판단에 맡긴다 (오탐이면 상담이 끊긴다)
  ])('일반 표현은 잡지 않는다: %s', (text) => {
    expect(hasCrisisKeyword(text)).toBe(false);
  });
});

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(analysis());

  it('피해자 이름·패턴·기간·가해자 수를 싣는다', () => {
    expect(prompt).toContain('윤아');
    expect(prompt).toContain('셔틀');
    expect(prompt).toContain('2026-03-04 ~ 2026-03-20');
    expect(prompt).toContain('가해자: 2명');
    expect(prompt).toContain('다수 단체 대화방');
  });

  it('제외된 구간의 유형·심각도는 쓰지 않는다', () => {
    expect(prompt).toContain('갈취강요');
    expect(prompt).not.toContain('협박');
    expect(prompt).toContain('주의');
    expect(prompt).not.toContain('즉시조치 \n');
    expect(prompt).toMatch(/심각도\(가장 높은 구간 기준\): 주의/);
  });

  it('가해자 이름과 구간 reason(실명 포함)은 싣지 않는다', () => {
    expect(prompt).not.toContain('민준');
    expect(prompt).not.toContain('지호');
    expect(prompt).not.toContain('빵을 요구');
  });
});

describe('toLlmMessages', () => {
  it('인사말(assistant)로 시작하는 이력 앞에 가상의 user 턴을 붙인다', () => {
    const out = toLlmMessages(
      [
        { role: 'assistant', content: '안녕하세요' },
        { role: 'user', content: '불안해요' },
        { role: 'assistant', content: '그랬군요' },
      ],
      '내일이 걱정돼요',
    );
    expect(out.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(out[0].content).toBe(INTRO_TRIGGER);
    expect(out.at(-1)).toEqual({ role: 'user', content: '내일이 걱정돼요' });
  });

  it('user 로 시작하는 이력(잘린 이력)에는 붙이지 않는다', () => {
    const out = toLlmMessages(
      [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
      'c',
    );
    expect(out.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });
});
