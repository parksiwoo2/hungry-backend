import {
  SafeguardAnalysisService,
  AnalyzeInput,
} from './safeguard-analysis.service';
import { z } from 'zod';
import { parseKakao } from './kakao-parser';
import {
  NoopPrecedentProvider,
  type PrecedentProvider,
} from './precedent-provider';

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
  const svc = new SafeguardAnalysisService(new NoopPrecedentProvider());

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
          candidateTypes: ['협박'],
        },
      ],
      patterns: [],
    });
    expect(targets).toHaveLength(2);
    // 1차의 후보 유형은 판례 검색 범위로만 쓰인다 (2차 프롬프트에는 들어가지 않음)
    expect(targets[1].candidateTypes).toEqual(['협박']);
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
    );
    expect(doc).toContain(
      '■ 2026-07-18T23:50 ~ 2026-07-18T23:59 · 정태오 (메시지 3개)',
    );
    expect(doc).toContain('정태오: "무시하냐 진짜"');
    expect(doc).toContain('■ 2026-07-19T00:07 · 정태오');
    expect(doc).toContain('스토킹처벌법 제18조');
    // 1:1이라 협박은 그대로 형법 283조 (공연성 불요)
    expect(doc).toContain('형법 제283조');
    // 문서는 한 종류 — 조문과 AI 근거가 같은 항목에 같이 나온다
    expect(doc).toContain('· AI 판단 근거: 연속 전송');
    expect(doc).toContain('· AI 판단 근거: 해악 고지');
  });

  it('buildDocument: 참고 판례가 있으면 사건·결론·인용 발언을 적고 없으면 그 절이 없다', () => {
    const inp = input();
    const flagged = [
      {
        messageNos: [6],
        harmTypes: ['협박'],
        severity: '즉시조치',
        reason: '해악 고지',
        appliedPrecedentIds: ['227693'],
      },
    ] as const;
    const summary = svc.aggregate([...flagged] as never, inp.messages);
    const precedent = {
      id: '227693',
      caseNumber: '2022도4171',
      court: '대법원',
      caseName: '정통망법위반(명예훼손)',
      decidedOn: '2022-07-28',
      summary: '비방할 목적의 의미',
      refLaws: '정보통신망법 제70조 제1항',
      quotedTexts: ['너희들도 조심해라.'],
      rulings: [
        { court: '대구지방법원 (원심)', guilty: true },
        { court: '대법원', guilty: false },
      ],
    };

    const withP = svc.buildDocument(
      inp,
      { flagged: [...flagged] as never, patterns: [] },
      summary,
      [precedent],
    );
    expect(withP).toContain('[참고 판례');
    expect(withP).toContain('■ 대법원 2022. 7. 28. 선고 2022도4171 판결');
    expect(withP).toContain('결론: 대구지방법원 (원심) 유죄 → 대법원 무죄');
    expect(withP).toContain('"너희들도 조심해라."');
    expect(withP).toContain('관련 구간: 2026-07-19T00:07 · 정태오');

    const without = svc.buildDocument(
      inp,
      { flagged: [...flagged] as never, patterns: [] },
      summary,
    );
    expect(without).not.toContain('참고 판례');
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

  it('analyze: 2차가 낸 판례 번호 중 매칭 사전에 없는 것은 걷어낸다', async () => {
    // 프롬프트로만 금지하던 것 — 사전에 없는 사건번호가 응답·문서로 새지 않게 코드가 막는다
    const provider: PrecedentProvider = {
      match: (inp) =>
        Promise.resolve({
          precedentDict: { '2006도546': '대법원 2006도546: 요지' },
          analysisTargets: inp.analysisTargets.map((t) => ({
            ...t,
            matchedPrecedentIds: ['2006도546'],
          })),
        }),
      describe: () => Promise.resolve([]),
    };
    const engine = new SafeguardAnalysisService(provider);
    jest.spyOn(engine, 'screen').mockResolvedValue({
      segments: [
        { messageNos: [6], victimIdentifiable: true, summary: '해악을 알림' },
      ],
      patterns: [],
    });
    jest.spyOn(engine, 'judge').mockResolvedValue({
      flagged: [
        {
          messageNos: [6],
          harmTypes: ['협박'],
          severity: '즉시조치',
          reason: '해악 고지',
          appliedPrecedentIds: ['2006도546', '9999도1'],
        },
      ],
      patterns: [],
    });

    const r = await engine.analyze(input());

    expect(r.flagged[0].appliedPrecedentIds).toEqual(['2006도546']);
  });

  it('buildDocument: 확정 구간이 없으면 기간 자리에 undefined 가 아니라 "확인된 피해 없음"이 나온다', () => {
    const inp = input();
    const empty = svc.aggregate([], inp.messages);
    const doc = svc.buildDocument(inp, { flagged: [], patterns: [] }, empty);
    expect(doc).not.toContain('undefined');
    expect(doc).toContain('확인된 피해가 없습니다');
    expect(doc).not.toMatch(/~ .*기간 동안/);
  });

  it('callStructured: 출력이 토큰 한도에서 잘리면 JSON 파싱 오류 대신 한도 초과를 알린다', async () => {
    // 데모12(277건) 실측 — 1차 출력이 8000 토큰에서 끊겨 "Unterminated string in JSON"으로 실패했다
    const engine = new SafeguardAnalysisService(new NoopPrecedentProvider());
    (engine as unknown as { _client: unknown })._client = {
      messages: {
        create: () =>
          Promise.resolve({
            stop_reason: 'max_tokens',
            content: [{ type: 'text', text: '{"segments":[{"summary":"잘린' }],
          }),
      },
    };
    type Call = (...a: unknown[]) => Promise<unknown>;
    const priv = engine as unknown as { callStructured: Call };
    const call: Call = (...a) => priv.callStructured(...a);

    await expect(
      call(
        '1차 선별',
        z.object({ segments: z.array(z.object({ summary: z.string() })) }),
        's',
        'c',
        'low',
      ),
    ).rejects.toThrow(/1차 선별 출력이 토큰 한도.*잘림/);
  });
});
