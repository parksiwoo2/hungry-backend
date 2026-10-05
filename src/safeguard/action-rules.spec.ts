import {
  ACTION_IDS,
  selectActionIds,
  type ActionRuleInput,
} from './action-rules';

const seg = (
  harmTypes: string[],
  severity = '관찰',
  excluded = false,
): ActionRuleInput['utterances'][number] => ({ harmTypes, severity, excluded });

const input = (over: Partial<ActionRuleInput>): ActionRuleInput => ({
  context: 'large_group',
  utterances: [seg(['모욕'])],
  patterns: [],
  isRepeated: false,
  ...over,
});

const BASE = [
  'CARD_NO_RETALIATION',
  'CARD_BACKUP_EVIDENCE',
  'CARD_NO_LEAVE_CHATROOM',
];

describe('selectActionIds — 분석 결과에서 행동 제시 카드를 고른다', () => {
  it('확정 구간이 없으면 카드도 없다', () => {
    expect(selectActionIds(input({ utterances: [] }))).toEqual([]);
  });

  it('사용자가 제외한 구간은 없는 것으로 본다', () => {
    expect(
      selectActionIds(
        input({ utterances: [seg(['성희롱'], '즉시조치', true)] }),
      ),
    ).toEqual([]);
    expect(
      selectActionIds(
        input({
          utterances: [seg(['모욕']), seg(['갈취강요'], '즉시조치', true)],
        }),
      ),
    ).toEqual(BASE);
  });

  it('경미한 구간 하나 — 기본 대응 세 장만', () => {
    expect(selectActionIds(input({}))).toEqual(BASE);
  });

  it('공개 게시판이면 대화방 나가기 금지는 빼준다', () => {
    expect(selectActionIds(input({ context: 'public' }))).toEqual([
      'CARD_NO_RETALIATION',
      'CARD_BACKUP_EVIDENCE',
    ]);
  });

  it('즉시조치 구간이 있으면 긴급 신고와 어른에게 알리기', () => {
    const ids = selectActionIds(
      input({ utterances: [seg(['협박'], '즉시조치')] }),
    );
    expect(ids).toEqual([
      'CARD_EMERGENCY_REPORT',
      ...BASE,
      'CARD_NO_MEETING',
      'CARD_INFORM_ADULT',
    ]);
  });

  it('갈취강요 — 송금 금지와 직접 만나지 않기', () => {
    const ids = selectActionIds(
      input({ utterances: [seg(['갈취강요', '집단따돌림'], '즉시조치')] }),
    );
    expect(ids).toContain('CARD_NO_MONEY_TRANSFER');
    expect(ids).toContain('CARD_NO_MEETING');
  });

  it('성희롱 — 성범죄 지원 연결과 거부 의사 표명', () => {
    expect(
      selectActionIds(
        input({ context: 'dm', utterances: [seg(['성희롱'], '주의')] }),
      ),
    ).toEqual([
      'CARD_SEXCRIME_SUPPORT',
      ...BASE,
      'CARD_INFORM_ADULT',
      'CARD_CLEAR_REFUSAL',
    ]);
  });

  it('떼카·스토킹·반복성 — 알림 끄기. 스토킹·반복성은 거부 의사 표명도', () => {
    expect(selectActionIds(input({ patterns: ['떼카'] }))).toEqual([
      ...BASE,
      'CARD_MUTE_NOTIFICATION',
    ]);
    expect(selectActionIds(input({ isRepeated: true }))).toEqual([
      ...BASE,
      'CARD_MUTE_NOTIFICATION',
      'CARD_INFORM_ADULT',
      'CARD_CLEAR_REFUSAL',
    ]);
    const stalking = selectActionIds(
      input({ utterances: [seg(['스토킹'], '주의')] }),
    );
    expect(stalking).toEqual([
      ...BASE,
      'CARD_MUTE_NOTIFICATION',
      'CARD_NO_MEETING',
      'CARD_INFORM_ADULT',
      'CARD_CLEAR_REFUSAL',
    ]);
  });

  it('여러 조건이 겹쳐도 카드는 한 번씩, 정의된 순서(우선순위)대로 나온다', () => {
    const ids = selectActionIds({
      context: 'large_group',
      utterances: [
        seg(['성희롱', '협박'], '즉시조치'),
        seg(['갈취강요', '스토킹'], '즉시조치'),
      ],
      patterns: ['떼카', '셔틀'],
      isRepeated: true,
    });
    expect(ids).toEqual([...ACTION_IDS]);
  });
});
