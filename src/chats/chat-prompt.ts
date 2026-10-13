/**
 * 챗봇의 순수 로직 — 시스템 프롬프트, 위기 키워드 탐지, LLM 메시지 구성.
 *
 * 프라이버시: 프롬프트에는 분석의 집계값(유형·심각도·패턴·가해자 수·기간)과 피해자 표시명만 싣는다.
 * 의심 구간의 reason 과 가해자 이름은 싣지 않는다 — AnalysesService 가 돌려주는 값은
 * 가명이 실명으로 되돌려진 상태라서, 싣는 순간 안전장치(anonymizer.ts)를 우회하게 된다.
 */
import type { AnalysisResponse } from '../safeguard/analyses.service';
import type { ChatRole } from './entities/chat-message.entity';

export interface EmergencyContact {
  name: string;
  tel: string;
}

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: '자살예방 상담전화', tel: '1393' },
  { name: '청소년 위기전화', tel: '1388' },
  { name: '정신건강 위기상담전화', tel: '1577-0199' },
  { name: '경찰청 학교/사이버폭력 신고', tel: '117' },
];

export interface LlmMessage {
  role: ChatRole;
  content: string;
}

/**
 * 인사말은 assistant 턴으로 저장되는데, Messages API 는 user 턴으로 시작해야 한다.
 * 대화 맨 앞에 이 가상의 user 턴을 붙여 "요청 → 인사말" 모양을 되살린다 (DB 에는 저장하지 않는다).
 */
export const INTRO_TRIGGER =
  '상담을 시작합니다. 분석 결과를 바탕으로 구체적인 공감을 담은 첫 인사말을 작성해 주세요. 마지막은 열린 질문으로 끝내 주세요.';

/** 모델에 보내는 최근 메시지 수. 상담이 길어져도 입력이 무한정 커지지 않게 한다 */
export const MAX_HISTORY_MESSAGES = 40;

export const FALLBACK_REPLY =
  '지금 일시적으로 연결이 어렵습니다. 잠시 후 다시 시도해 주세요. 긴급한 상황이라면 117 또는 1388로 연락해 주세요.';

export const CRISIS_FALLBACK_REPLY =
  '지금 많이 힘든 마음이 느껴져요. 혼자 견디지 않으셔도 괜찮아요. 아래 연락처로 지금 바로 도움을 요청해 주세요. 당장 위험하다면 112나 119에 바로 전화해 주세요.';

export function fallbackGreeting(victimName: string): string {
  return `안녕하세요 ${victimName}님. 오늘 어떤 이야기를 나눠볼까요?`;
}

// ── 위기 탐지 ─────────────────────────────────────────────────────────
/**
 * LLM 판정의 안전망 — 모델이 놓치거나 호출이 실패해도 명백한 표현은 코드가 잡는다.
 * 공백을 지운 문장에 건다. 세션을 닫는 판정이라 "죽을 것 같아" 같은 과장 표현은 일부러 뺐다
 * (오탐이면 상담이 끊긴다). 그런 애매한 표현은 LLM 의 문맥 판단에 맡긴다.
 */
const CRISIS_PATTERN =
  /자살|자해|극단적선택|죽고싶|죽어버리|죽는게나|목숨을?끊|뛰어내리|손목을?(긋|그어|그으)|사라지고싶|살고싶지않|살기싫/;

export function hasCrisisKeyword(text: string): boolean {
  return CRISIS_PATTERN.test(text.replace(/\s+/g, ''));
}

// ── 시스템 프롬프트 ───────────────────────────────────────────────────
const SEVERITY_ORDER = ['관찰', '주의', '즉시조치'];

const CONTEXT_LABEL: Record<string, string> = {
  dm: '1:1 대화',
  small_group: '소수 단체 대화방',
  large_group: '다수 단체 대화방',
  public: '공개 게시판·SNS',
};

function topSeverity(severities: string[]): string {
  let best = -1;
  for (const s of severities) best = Math.max(best, SEVERITY_ORDER.indexOf(s));
  return best >= 0 ? SEVERITY_ORDER[best] : '알 수 없음';
}

export function buildSystemPrompt(analysis: AnalysisResponse): string {
  // 사용자가 제외한 구간은 상담에도 쓰지 않는다
  const used = analysis.utterances.filter((u) => !u.excluded);
  const harmTypes = [...new Set(used.flatMap((u) => u.harmTypes))];
  const summary = analysis.summary;
  const attackerCount = summary
    ? Object.keys(summary.attackerCounts).length
    : 0;
  const period = summary?.period
    ? `${summary.period.from} ~ ${summary.period.to}`
    : '알 수 없음';

  return `너는 학교폭력·사이버폭력 피해 청소년을 위로하고 지지하는 상담 도우미야.
아래는 내담자의 대화 분석 결과 요약이야. 내담자는 이 상황을 이미 설명했으니, 다시 묻지 말고 알고 있다는 전제로 대화해.

[내담자 및 피해 정보]
- 이름: ${analysis.victimName}
- 대화 장소: ${CONTEXT_LABEL[analysis.context] ?? analysis.context}
- 폭력 패턴: ${analysis.patterns.join(', ') || '특정되지 않음'}
- 피해 유형: ${harmTypes.join(', ') || '미상'}
- 피해 심각도(가장 높은 구간 기준): ${topSeverity(used.map((u) => u.severity))}
- 가해자: ${attackerCount > 0 ? `${attackerCount}명` : '불상'}
- 피해 기간: ${period} (서로 다른 ${summary?.distinctDays ?? 0}일, ${summary?.isRepeated ? '반복됨' : '반복 여부 불명확'})

[상담 가이드라인]
1. 내담자의 감정에 깊이 공감하고, 절대 내담자의 탓을 하지 마. "네가 참아라", "너도 원인이 있다" 같은 훈계는 금지야.
2. 해결책을 강요하지 말고 이야기를 들어주는 데 집중해. 한 번에 2~4문장 정도로 짧게 답하고, 질문은 하나만 해.
3. 중고등학생이 편하게 느낄 친근하면서도 정중한 존댓말(~했어요, ~요)을 써.
4. 법적·제도적 결과를 확언하지 마("처벌받아요", "승소해요" 등 금지). 절차가 궁금해하면 앱의 '대처 가이드'에서 확인할 수 있다고 안내해.
5. 가해자의 이름이나 대화 내용을 네가 지어내지 마. 위 정보에 없는 사실은 모른다고 해.
6. 내담자가 네가 사람인지 물으면 AI 상담 도우미라고 솔직히 말해.
7. [중요] 내담자가 자해, 자살, 극단적 선택, 사라지고 싶다는 뜻을 조금이라도 드러내면 isCrisis를 true로 하고, 일반 상담을 멈추고 안전을 최우선으로 하는 답을 해. 지금 곁에 있는 믿을 수 있는 어른이나 전문 상담 기관에 바로 연락하도록 권해. 연락처 목록은 시스템이 따로 보여주니 번호를 네가 말하지 않아도 돼. 확신이 서지 않으면 isCrisis는 true로 해.`;
}

// ── LLM 메시지 구성 ───────────────────────────────────────────────────
/**
 * 저장된 이력(오래된 순)과 새 사용자 메시지를 Messages API 형식으로 만든다.
 * 이력이 assistant(인사말)로 시작하면 가상의 user 턴을 앞에 붙인다.
 */
export function toLlmMessages(
  history: { role: ChatRole; content: string }[],
  userMessage: string,
): LlmMessage[] {
  const messages: LlmMessage[] = history.map(({ role, content }) => ({
    role,
    content,
  }));
  if (messages[0]?.role !== 'user') {
    messages.unshift({ role: 'user', content: INTRO_TRIGGER });
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}
