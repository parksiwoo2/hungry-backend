/**
 * 행동 제시 카드 선택 — 분석 결과(유형·정도·패턴·반복성·대화 장소)에서 카드 ID를 고른다.
 *
 * AI가 아니라 코드가 고른다. 카드의 발동 조건은 2차 판단이 이미 내는 값으로 표현되고,
 * 규칙이면 같은 분석에 항상 같은 카드가 나오며 긴급 카드가 빠지는 일이 없다.
 * 저장하지 않고 조회할 때마다 계산한다 — 규칙을 고치면 과거 분석에도 바로 반영되고,
 * 사용자가 제외(excluded)한 구간은 자동으로 빠진다.
 *
 * 카드의 문구·tier·priority 는 팀 행동 제시 모듈의 action_mapping.json 이 정본이다.
 * 여기는 ID만 안다 — 그 파일에 카드를 추가·삭제하면 ACTION_IDS 와 규칙을 같이 맞출 것.
 */
import type { ChatContext } from './safeguard-analysis.service';

/** 카드 ID — action_mapping.json 의 priority 순서 */
export const ACTION_IDS = [
  'CARD_EMERGENCY_REPORT', //   긴급 신고하기 (117·112)
  'CARD_SEXCRIME_SUPPORT', //   성범죄 관련 지원 연결
  'CARD_NO_RETALIATION', //     맞대응하지 않기
  'CARD_BACKUP_EVIDENCE', //    대화 내용 백업·캡처
  'CARD_NO_LEAVE_CHATROOM', //  대화방 나가기(삭제) 금지
  'CARD_MUTE_NOTIFICATION', //  알림 끄기
  'CARD_NO_MONEY_TRANSFER', //  송금 금지
  'CARD_NO_MEETING', //         직접 만나지 않기
  'CARD_INFORM_ADULT', //       어른에게 알리기
  'CARD_CLEAR_REFUSAL', //      1회의 명확한 거부 의사 표명
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface ActionRuleInput {
  context: ChatContext;
  utterances: { harmTypes: string[]; severity: string; excluded: boolean }[];
  patterns: string[];
  /** 서로 다른 3일 이상에 걸쳐 발생 (Summary.isRepeated) */
  isRepeated: boolean;
}

export function selectActionIds(input: ActionRuleInput): ActionId[] {
  const active = input.utterances.filter((u) => !u.excluded);
  if (active.length === 0) return [];

  const has = (type: string) => active.some((u) => u.harmTypes.includes(type));
  const urgent = active.some((u) => u.severity === '즉시조치');
  const caution = active.some((u) => u.severity === '주의');
  const stalking = has('스토킹');

  const rules: Record<ActionId, boolean> = {
    // 해악 고지·금품 요구·성적 내용·신상 언급 등 — 혼자 판단하지 말고 바로 도움을 받게 한다
    CARD_EMERGENCY_REPORT: urgent,
    CARD_SEXCRIME_SUPPORT: has('성희롱'),

    // 확정 구간이 하나라도 있으면 항상
    CARD_NO_RETALIATION: true,
    CARD_BACKUP_EVIDENCE: true,
    // 게시판·SNS 에는 나갈 대화방이 없다
    CARD_NO_LEAVE_CHATROOM: input.context !== 'public',

    // 메시지가 몰려오는 상황 — 다수의 집중 공격, 반복 연락, 여러 날에 걸친 지속
    CARD_MUTE_NOTIFICATION:
      input.patterns.includes('떼카') || stalking || input.isRepeated,
    CARD_NO_MONEY_TRANSFER: has('갈취강요'),
    // 대면하면 위험해질 수 있는 유형
    CARD_NO_MEETING: has('협박') || stalking || has('갈취강요'),
    CARD_INFORM_ADULT: urgent || caution || input.isRepeated,
    // 거부 의사를 남겨 두는 것이 이후 판단에 의미가 있는 유형 (거부 뒤의 재접근은 더 무겁게 본다)
    CARD_CLEAR_REFUSAL: stalking || has('성희롱') || input.isRepeated,
  };

  return ACTION_IDS.filter((id) => rules[id]);
}
