import {
  SafeguardAnalysisService,
  AnalyzeInput,
} from './safeguard-analysis.service';
import { parseKakao } from './kakao-parser';

// 1:1 샘플과 같은 구조의 작은 대화 — 구간 로직(AI 호출 없음)만 검증한다
const RAW = [
  '--------------- 2026년 7월 18일 토요일 ---------------',
  '[정태오] [오후 9:30] 야 너 아까 전화 왜 씹음',
  '[김하늘] [오후 9:40] 학원이야',
  '[정태오] [오후 11:50] 자냐',
  '[정태오] [오후 11:51] 답장해라',
  '[정태오] [오후 11:59] 무시하냐 진짜',
  '--------------- 2026년 7월 19일 일요일 ---------------',
  '[정태오] [오전 12:07] 한 번만 더 보이면 가만 안 둔다',
  '[김하늘] [오전 12:10] 무섭게 왜 그래',
].join('\n');

function input(): AnalyzeInput {
  const messages = parseKakao(RAW);
  return {
    messages,
    context: 'dm',
    participantCount: 2,
    victimName: '김하늘',
    victimInRoom: true,
  };
}

describe('SafeguardAnalysisService — 구간 단위 로직', () => {
  const svc = new SafeguardAnalysisService();

  it('buildAnalysisTargets: 구간 하나가 타깃 하나, targetText = 요약 + 원문', () => {
    const targets = svc.buildAnalysisTargets(input(), {
      segments: [
        {
          messageNos: [3, 4, 5],
          victimIdentifiable: true,
          summary: '응답 없는 상대에게 심야에 연속 전송',
        },
        {
          messageNos: [6],
          victimIdentifiable: true,
          summary: '조건을 걸어 위해를 예고',
        },
      ],
      patterns: [],
    });
    expect(targets).toHaveLength(2);
    expect(targets[0].targetMessageId).toBe('3,4,5');
    expect(targets[0].targetText).toBe(
      '응답 없는 상대에게 심야에 연속 전송\n자냐\n답장해라\n무시하냐 진짜',
    );
    expect(targets[0].legalContext).toEqual({
      isGroupChat: false,
      audienceCount: 2,
      victimIdentifiable: true,
    });
    expect(targets[1].targetMessageId).toBe('6');
  });

  it('aggregate: 건수는 구간 단위, 발신자·날짜는 구간 안 메시지 전부로 센다', () => {
    const { messages } = input();
    const s = svc.aggregate(
      [
        {
          messageNos: [3, 4, 5],
          harmTypes: ['스토킹'],
          severity: '주의',
          reason: '',
          appliedPrecedentIds: [],
        },
        {
          messageNos: [6],
          harmTypes: ['협박'],
          severity: '즉시조치',
          reason: '',
          appliedPrecedentIds: [],
        },
      ],
      messages,
    );
    expect(s.count).toBe(2); //                     구간 2개
    expect(s.attackerCounts).toEqual({ 정태오: 4 }); // 메시지 4개
    expect(s.typeCounts).toEqual({ 스토킹: 1, 협박: 1 });
    expect(s.urgentCount).toBe(1);
    expect(s.start).toBe('2026-07-18T23:50');
    expect(s.end).toBe('2026-07-19T00:07');
    expect(s.distinctDays).toBe(2);
    expect(s.isRepeated).toBe(false);
  });

  it('buildDocument: 구간 항목은 발화마다 인용 한 줄, 단독 구간은 기존 형식', () => {
    const inp = input();
    const flagged = [
      {
        messageNos: [3, 4, 5],
        harmTypes: ['스토킹'],
        severity: '주의',
        reason: '연속 전송',
        appliedPrecedentIds: [],
      },
      {
        messageNos: [6],
        harmTypes: ['협박'],
        severity: '즉시조치',
        reason: '해악 고지',
        appliedPrecedentIds: [],
      },
    ] as const;
    const doc = svc.buildDocument(
      inp,
      { flagged: [...flagged] as never, patterns: [] },
      svc.aggregate([...flagged] as never, inp.messages),
      true,
    );
    expect(doc).toContain(
      '■ 2026-07-18T23:50 ~ 2026-07-18T23:59 · 정태오 (메시지 3개)',
    );
    expect(doc).toContain('정태오: "무시하냐 진짜"');
    expect(doc).toContain('■ 2026-07-19T00:07 · 정태오');
    expect(doc).toContain('스토킹처벌법 제18조');
    // 1:1이라 협박은 그대로 형법 283조 (공연성 불요)
    expect(doc).toContain('형법 제283조');
  });

  it('detectSystemPatterns: 다중 초대 대상에 피해자가 있어도 방폭을 센다', () => {
    const msgs = [
      {
        sender: '갑',
        time: '2026-01-01T10:00',
        text: '',
        systemEvent: 'invite' as const,
        target: '병',
        targets: ['병', '을'],
      },
      {
        sender: '정',
        time: '2026-01-01T10:02',
        text: '',
        systemEvent: 'leave' as const,
        target: '정',
      },
      {
        sender: '무',
        time: '2026-01-01T10:05',
        text: '',
        systemEvent: 'leave' as const,
        target: '무',
      },
    ];
    expect(svc.detectSystemPatterns(msgs, '을')).toEqual(['방폭']);
  });
});
