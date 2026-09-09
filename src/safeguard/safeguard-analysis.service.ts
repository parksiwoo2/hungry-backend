/**
 * Safe Guard — 대화 분석(#2) + 문서 생성(#4)  [담당: 변경호 / NestJS]
 *
 * 2패스 구조:
 *   1차 선별(AI)   유해 "구간"(같은 행위를 이루는 메시지 묶음) 수집 + 특정성 + 사실 요약. 성립 판단 안 함.
 *                  애매하면 포함 — 여기서 빠지면 복구 불가, 잘못 들어간 건 2차가 거름.
 *   판례 매칭      팀원 모듈(벡터 DB) — targetText와 가장 가까운 판례 문구 3개.
 *                  준비 전까지 MockPrecedentProvider (precedent-provider.ts).
 *   2차 판단(AI)   구간 원문 + 판례 + 요약으로 유형·정도 확정. 무관 판례는 버리게 지시.
 *   집계·문서      코드. 조문·형량은 law-articles.json(법령 API 수집)에서.
 *
 * 원칙:  의미 판단은 AI가, 숫자 집계·법조항은 코드가.
 * 근거:  판례-풀.json(사건번호·요지 전부 판례 API 원문) + safeguard-law-reference.md
 *
 * deps: npm i @anthropic-ai/sdk zod
 */
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LawRegistry, REMOVAL_TRACK, CIVIL_TRACK } from './law-registry';
import { NoopPrecedentProvider } from './precedent-provider';
import type {
  AnalysisTarget,
  PrecedentMatchOutput,
  PrecedentProvider,
} from './precedent-provider';
import { anonymizeInput, deanonymize } from './anonymizer';

const MODEL = 'claude-opus-5';

// ── 입력 타입 ─────────────────────────────────────────────────────────
/** 대화 장소 = 공연성 판단의 최상위 분기 (대법원 2020도5813 전합) */
export type ChatContext =
  | 'dm' //           1:1 DM — 공연성 ✕ → 모욕·명예훼손 불성립 (전파가능성 예외는 2차가 판례로)
  | 'small_group' //  소수 사적 단톡(3~5인, 친밀) — 전파가능성 판단 필요
  | 'large_group' //  다수·공적 단톡(6인+, 학급·직장) — 공연성 ○
  | 'public'; //      공개 게시판·SNS — 공연성 ○

/** 시스템 이벤트 — 방폭·카톡감옥은 텍스트에 욕설이 0건이라 이게 없으면 탐지 불가 */
export type SystemEventKind = 'join' | 'leave' | 'invite' | 'kick' | 'delete';

export interface ChatMessage {
  sender: string; // 발신자 (마스킹됨)
  time: string; // ISO 8601 권장 (반복성 계산에 사용)
  text: string; // 본문. 시스템 이벤트면 원문 그대로
  systemEvent?: SystemEventKind; // 입·퇴장·초대·강퇴·삭제
  target?: string; // 시스템 이벤트의 대상자 (다중이면 첫 번째)
  targets?: string[]; // 다중 초대·강퇴의 전체 대상 (그룹 내보내기 "A님, B님과 C님을 초대")
}

export interface AnalyzeInput {
  messages: ChatMessage[];
  context: ChatContext;
  participantCount: number; // 대화방 인원 (따돌림 2명 이상 요건 판단)
  victimName: string; // 피해자 = 사용자 본인 (마스킹된 표시명)
  victimInRoom: boolean; // 피해자가 그 방 구성원인가 (학폭 도달성 요건)
}

// ── 1차 선별 스키마 — 단위는 "구간"(같은 행위를 이루는 메시지 묶음) ──────
const Segment = z.object({
  messageNos: z
    .array(z.number().int())
    .min(1)
    .describe('구간에 속한 가해 측 발화의 메시지 번호 (오름차순)'),
  victimIdentifiable: z
    .boolean()
    .describe('피해자가 식별되는가 — 이름·2인칭·멘션·맥락 지목 포함'),
  summary: z
    .string()
    .describe(
      '누가 무엇을 어떤 순서로 했는지 사실만 한두 문장. 죄명·유형 단어 금지. 판례 검색 질의로도 쓰임',
    ),
});
const PatternName = z.enum([
  '떼카',
  '카톡감옥',
  '방폭',
  '반톡배제',
  '은따',
  '셔틀',
  '저격글',
]);
const Patterns = z
  .array(PatternName)
  .describe('대화 전체에서 관찰된 집단 괴롭힘 패턴');
const ScreeningResult = z.object({
  segments: z.array(Segment),
  patterns: Patterns,
});
export type ScreenedSegment = z.infer<typeof Segment>;
export type Screening = z.infer<typeof ScreeningResult>;

// ── 2차 판단 스키마 ───────────────────────────────────────────────────
const HarmType = z.enum([
  '언어폭력',
  '명예훼손',
  '모욕',
  '성희롱',
  '협박',
  '스토킹',
  '집단따돌림',
  '갈취강요',
]);
const Severity = z.enum(['관찰', '주의', '즉시조치']); // 점수 아님(구간)

const Judged = z.object({
  messageNos: z
    .array(z.number().int())
    .min(1)
    .describe(
      '이 판정이 적용되는 구간의 메시지 번호들 (입력 구간의 번호 중에서만)',
    ),
  harmTypes: z
    .array(HarmType)
    .describe('복수 가능 — 실제로 별개 행위가 성립하는 경우만'),
  severity: Severity,
  reason: z
    .string()
    .describe('판단 근거 한 줄. 판례를 적용했으면 그 취지를 반영'),
  appliedPrecedentIds: z
    .array(z.string())
    .describe('실제 판단 근거로 삼은 판례 사건번호. 없으면 빈 배열'),
});
const JudgmentResult = z.object({ judged: z.array(Judged) });
export type FlaggedItem = z.infer<typeof Judged>;

// 모델이 enum 밖 값을 낼 때 걷어내기 위한 허용 집합 (callStructured 참고)
const HARM_SET = new Set<string>(HarmType.options);
const PATTERN_SET = new Set<string>(PatternName.options);

// ── 법 조항 매핑 ─────────────────────────────────────────────────────
// 형량·조문 원문은 law-articles.json(법령 API 수집)에서 읽는다.
// 유형→조문 매핑과 소추요건은 law-registry.ts (판례 기반, 우리 자산).

// ── 1차 프롬프트: 후보 선별 ───────────────────────────────────────────
const SYSTEM_SCREEN = `너는 한국 사이버폭력 대화의 1차 선별기다.
번호가 매겨진 대화 전체를 읽고, 가해로 볼 여지가 있는 메시지를 골라
같은 행위를 이루는 것끼리 하나의 구간으로 묶어 반환한다.
성립 여부의 최종 판단은 다음 단계가 판례를 근거로 수행한다. 너는 고르고 묶기만 한다.

## 원칙
- 여기서 빠진 메시지는 이후 단계에 전달되지 않는다. 애매하면 포함하라.
- 확실히 무해한 것만 제외하라.
- 유형·피해정도를 판정하지 마라. 그것은 다음 단계의 일이다.

## 제외하는 것 (이것만 거른다)
- 일상 대화와 피해자 본인의 발화
- 무례·불쾌 수준에 그치는 표현
- 특정인을 지목하지 않는 감탄사형 욕설 ("ㅅㅂ 시험 망함"은 감탄사다)
- 일상 축약 초성체: ㅇㅇ ㅇㅋ ㄱㅅ ㄴㄴ ㅁㄹ ㅈㅅ ㅃㄹ ㅊㅊ ㄱㅇㄷ ㅎㅇ
- 쌍방이 같은 강도로 주고받고 양쪽 모두 웃음 표현을 쓰는 장난

## 포함하는 것 (하나라도 해당하면 후보)
개별 메시지에서:
- 인격·외모·신체·지능에 대한 비하와 낙인
- 특정인을 지목한 욕설 (2인칭·이름·멘션과 결합)
- 참·거짓을 검증할 수 있는 사실을 퍼뜨리는 발언
- 해악의 고지 또는 암시
- 성적 표현·성적 조롱, 가족을 대상으로 한 성적 비하(패드립), 장애 비하
- 대가 없는 일방적 금품·심부름 요구
- 배제 명령형 초성 (ㄷㅊ·ㄲㅈ·ㅈㄲ)
전체 흐름에서 (대화 전체를 읽어야 보인다):
- 피해자가 거부 의사("그만해" 등)를 밝힌 뒤의 모든 공격적 발화
- 비하·요구 직후의 동조성 반응 — ㅋㅋ·ㅇㅈ·ㄱㄱ도 이 맥락이면 포함.
  가해자만 웃고 대상자는 웃지 않으면 조롱이다.
- 응답 없는 상대에 대한 연속 전송, 심야의 반복
- 다수에게 특정인 공격을 지시하거나 실행을 보조하는 발언
- 관찰된 집단 패턴(카톡감옥 등)을 구성하는 발언

## 구간으로 묶는 규칙
- 구간 하나 = 행위 하나. 같은 목적으로 이어지는 발화들을 한 구간에 넣어라.
  예: 심부름 요구 → 거절 무시 → 불이익 암시 → 요구 가중은 며칠에 걸쳐도 한 구간이다.
- 서로 다른 행위(예: 외모 조롱과 금품 요구)는 다른 구간으로 나눠라.
- 단독 발화도 구간 하나다.
- messageNos에는 가해 측 발화의 번호만 넣어라. 피해자의 발화는 넣지 말되,
  거부 의사·해명 같은 흐름 판단에는 사용하라.
- 동조성 반응(웃음·동의)은 그것이 따라붙은 발화와 같은 구간에 넣어라.
- 한 메시지는 하나의 구간에만 속한다. 구간은 첫 메시지 번호 순으로 정렬하라.

## 각 구간에 붙이는 것
- messageNos: 구간에 속한 가해 발화의 번호들 (오름차순)
- victimIdentifiable: 피해자가 식별되는가.
  이름·2인칭·멘션뿐 아니라 "어떤 애가" 식의 맥락 지목도 식별로 본다.
- summary: 이 구간에서 누가 무엇을 어떤 순서로 했는지 한두 문장으로 요약하라.
  다음 단계는 대화 전체를 보지 못하므로 직전의 거부 의사, 쌍방 언쟁 여부, 반복 회차,
  상대의 반응을 담아라. 이 요약은 판례 검색 질의로도 쓰이니 행위·수단·반복을 구체적으로 적어라.
  죄명·유형 단어(협박, 모욕, 셔틀, 카톡감옥 등)를 쓰지 마라. 관찰된 사실만 기술하라.
  판정은 다음 단계의 일이고, 네 요약에 판정이 섞이면 다음 단계가 그것에 끌려간다.

## patterns — 대화 전체에서 관찰된 집단 괴롭힘 패턴
- 카톡감옥: 피해자가 나간 뒤 재초대 2회 이상 / 방폭: 초대 직후 다수 동시 퇴장
- 떼카: 3인 이상이 단시간에 1인 집중 공격 / 셔틀: 일방적 심부름·금품 요구의 반복
- 반톡배제·은따·저격글
- 입·퇴장 시스템 이벤트는 구간에 넣지 말고 패턴 판단과 summary에 반영하라.`;

// ── 2차 프롬프트: 판례 근거 판단 ──────────────────────────────────────
const SYSTEM_JUDGE = `너는 사이버폭력 후보 구간의 2차 판단자다.
1차가 넉넉히 수집한 구간(같은 행위를 이루는 메시지 묶음) 각각에,
벡터 검색으로 찾은 인접 판례가 최대 3개 붙어 있다.
각 구간에는 원문이 함께 있다 — ▶ 표시가 구간에 속한 발화이고, 표시 없는 줄은
그 사이·전후의 피해자 응답 등 맥락이다. 1차의 요약은 참고일 뿐이다 — 판단은 원문을 직접 읽고 하라.

## 판례 사용 규칙
- 판례는 유사도 순 후보일 뿐 적용을 보증하지 않는다. 사안과 무관하면 버려라.
- 실제 판단의 근거로 삼은 판례만 appliedPrecedentIds에 넣어라. 없으면 빈 배열.
- 적합한 판례가 없어도 명백히 유해한 행위는 아래 기준으로 판단하라.
- 제공된 사건번호 외의 판례를 지어내지 마라.

## 구간 탈락·분리
- 1차는 애매한 것을 모두 포함했다. 유해성이 인정되지 않는 구간은 반환하지 마라.
- 한 구간이 실제로는 별개 행위 둘이면 messageNos를 나눠 두 항목으로 반환해도 된다.
  반대로 서로 다른 구간을 합치지는 마라.
- 반환하는 messageNos는 입력 구간의 번호 중에서만 고르고, 구간 안의 일부 발화가
  유해하지 않으면 그 번호는 빼라.

## 판단 기준
- 유형은 구간 전체의 행위에 대해 판정한다. 복수 태그는 실제로 별개 행위가 성립하는 경우만.
  모욕과 언어폭력을 같은 구간에 동시에 붙이지 마라 —
  언어폭력은 모욕·명예훼손 중 어느 쪽인지 확정하기 어려운 경우에만 쓴다.
- 협박: 구체적 해악의 고지가 있어야 한다. 압박·재촉·조롱·퇴장 금지 명령만으로는
  협박이 아니다. 말다툼 중 즉발적 분노 표시는 협박이 아니나, 거부 의사를 밝힌
  상대에 대한 일방적 해악 고지는 협박이다. 피해자가 실제 공포를 느꼈는지는 묻지 않는다.
- 명예훼손: 검증 가능한 구체적 사실의 적시가 필요하다. 추상적 경멸은 모욕이다.
- 공연성: legalContext를 보라. isGroupChat이 false면 모욕·명예훼손은 성립이 어렵다.
  다만 상대가 제3자에게 전파할 가능성이 있는 구조면 예외가 인정될 수 있다 —
  판례가 있으면 그에 따르라.
- 성적 표현: 행위자의 의도가 아니라 피해자와 같은 성별·연령대의 일반적이고 평균적인
  사람의 관점에서 판단한다. 분노와 결합된 성적 조롱도 성희롱이다.
- 집단따돌림: 가해자 2명 이상 + 지속·반복이 필요하다.
  동조성 반응(웃음·동의)도 구성 발화로 본다.
- 갈취·강요: 요구와 해악 고지가 한 구간 안에서 결합돼 있으면 그 결합 자체를 평가하라.
- severity는 구간 단위: 관찰(경미·동조성) / 주의(지목 비하·반복 조짐) /
  즉시조치(해악 고지·금품 요구·성적 내용·신상 언급·거부 의사 후 재접근·패드립·장애 비하)
- "신고할 정도는 아니다" 같은 판정 표현을 쓰지 마라. 상태만 기술하라.
- 이 분석은 참고용이며 법적 판단이 아니다.`;

interface Summary {
  count: number;
  start?: string;
  end?: string;
  typeCounts: Record<string, number>;
  urgentCount: number;
  attackerCounts: Record<string, number>;
  distinctDays: number; // 반복성 판단 (서로 다른 날 3회 이상)
  isRepeated: boolean;
}

@Injectable()
export class SafeguardAnalysisService {
  /** 지연 초기화 — 부팅·테스트 시 API 키가 없어도 모듈이 뜨고, 첫 분석 요청 때 검증된다 */
  private readonly logger = new Logger(SafeguardAnalysisService.name);
  private _client?: Anthropic;
  private get client(): Anthropic {
    return (this._client ??= new Anthropic()); // ANTHROPIC_API_KEY 환경변수
  }

  private readonly laws = new LawRegistry();
  /** 판례 매칭 모듈(벡터 DB) 연결 지점 — 팀원 구현이 오면 이 필드를 교체 */
  private readonly precedents: PrecedentProvider = new NoopPrecedentProvider();

  /** 대화에 번호 매기기 — 시스템 이벤트도 함께 (방폭·카톡감옥 탐지에 필수) */
  private numberConversation(input: AnalyzeInput): string {
    const header = [
      `[대화 정보]`,
      `- 장소: ${this.contextLabel(input.context)} (참여 인원 ${input.participantCount}명)`,
      `- 피해자: ${input.victimName}${input.victimInRoom ? '' : ' (이 방의 구성원이 아님)'}`,
      ``,
      `[대화 내용]`,
    ].join('\n');

    const body = input.messages
      .map((m, i) => {
        const no = String(i + 1).padStart(4, '0');
        if (m.systemEvent) {
          const kindLabel = {
            join: '입장',
            leave: '퇴장',
            invite: '초대',
            kick: '강퇴',
            delete: '메시지 삭제',
          }[m.systemEvent];
          const who =
            m.systemEvent === 'delete'
              ? ''
              : `${(m.targets ?? [m.target ?? m.sender]).join(', ')} `;
          return `[${no}] ${m.time} <시스템: ${who}${kindLabel}>`;
        }
        return `[${no}] ${m.time} ${m.sender}: ${m.text}`;
      })
      .join('\n');

    return `${header}\n${body}`;
  }

  private contextLabel(c: ChatContext): string {
    return {
      dm: '1:1 개인 대화',
      small_group: '소수 단체 대화방',
      large_group: '다수 단체 대화방',
      public: '공개 게시판·SNS',
    }[c];
  }

  /**
   * 시스템 이벤트 기반 패턴의 결정론적 검출 — AI가 필요 없는 절반.
   *
   * 카톡감옥·방폭은 입·퇴장 로그만으로 정의가 완결된다(누락 없음·설명 가능·무비용).
   * 의미 판단이 필요한 떼카·셔틀·은따·저격글·반톡배제만 1차 AI가 맡고,
   * analyze()가 둘을 합집합한다.
   */
  detectSystemPatterns(messages: ChatMessage[], victimName: string): string[] {
    const found = new Set<string>();
    const hits = (m: ChatMessage) =>
      (m.targets ?? [m.target]).includes(victimName);

    // 카톡감옥: 피해자 퇴장 → 재초대가 2회 이상
    let leaves = 0;
    let reinvites = 0;
    for (const m of messages) {
      if (!hits(m)) continue;
      if (m.systemEvent === 'leave') leaves++;
      if (m.systemEvent === 'invite' && leaves > 0) reinvites++;
    }
    if (reinvites >= 2) found.add('카톡감옥');

    // 방폭: 피해자 초대·입장 직후 10분 내 타인 2명 이상 퇴장
    const TEN_MIN = 10 * 60 * 1000;
    messages.forEach((m, i) => {
      const entered =
        (m.systemEvent === 'invite' || m.systemEvent === 'join') && hits(m);
      if (!entered) return;
      const t0 = Date.parse(m.time);
      const leavers = new Set(
        messages
          .slice(i + 1)
          .filter(
            (x) =>
              x.systemEvent === 'leave' &&
              x.target !== victimName &&
              Date.parse(x.time) - t0 <= TEN_MIN,
          )
          .map((x) => x.target ?? x.sender),
      );
      if (leavers.size >= 2) found.add('방폭');
    });

    return [...found];
  }

  /**
   * 구조화 출력 호출. SDK의 parse()는 값 하나만 스키마를 벗어나도 전체를 던지는데,
   * 실측(2026-09-09)에서 2차가 enum 밖 harmType을 한 번 냈다. 직접 파싱해서
   * enum 배열의 위반 값만 걷어내고 나머지는 그대로 검증한다. 그래도 어긋나면 던진다.
   */
  private async callStructured<S extends z.ZodType>(
    label: string,
    schema: S,
    system: string,
    content: string,
    effort: 'low' | 'medium',
  ): Promise<z.infer<S>> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(schema), effort },
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`${label}이 거부됨(안전 분류). 입력을 확인하세요.`);
    }
    const raw = response.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('');
    const cleaned = this.dropInvalidEnumValues(label, JSON.parse(raw));
    const parsed = schema.safeParse(cleaned);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`${label} 출력이 스키마와 다름 — ${issues}`);
    }
    return parsed.data;
  }

  /** patterns·harmTypes 배열에서 정의 밖 값을 제거. 유형이 하나도 안 남은 판정은 버린다 */
  private dropInvalidEnumValues(label: string, value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const v = value as Record<string, unknown>;
    const keep = (
      arr: unknown,
      allowed: Set<string>,
      what: string,
    ): unknown => {
      if (!Array.isArray(arr)) return arr;
      const list = arr as unknown[];
      const bad = list.filter((x) => !allowed.has(String(x)));
      if (bad.length) {
        this.logger.warn(`${label}: 정의 밖 ${what} 제거 — ${bad.join(', ')}`);
      }
      return list.filter((x) => allowed.has(String(x)));
    };
    if ('patterns' in v) v.patterns = keep(v.patterns, PATTERN_SET, '패턴');
    if (Array.isArray(v.judged)) {
      v.judged = v.judged.filter((j: unknown) => {
        if (!j || typeof j !== 'object') return true; // 스키마 검증에 맡김
        const item = j as Record<string, unknown>;
        item.harmTypes = keep(item.harmTypes, HARM_SET, '유형');
        const empty =
          Array.isArray(item.harmTypes) && item.harmTypes.length === 0;
        if (empty) {
          this.logger.warn(
            `${label}: 유형이 남지 않은 판정 제외 — 구간 ${String(item.messageNos)}`,
          );
        }
        return !empty;
      });
    }
    return v;
  }

  /** 1차 선별 — 구간 묶음 + 특정성 + 사실 요약. 가볍게(effort low) */
  async screen(input: AnalyzeInput): Promise<Screening> {
    return this.callStructured(
      '1차 선별',
      ScreeningResult,
      SYSTEM_SCREEN,
      this.numberConversation(input),
      'low',
    );
  }

  /** 구간 식별자 — 계약의 targetMessageId. 번호 나열이라 그 자체로 역추적 가능 */
  static segmentId(messageNos: number[]): string {
    return messageNos.join(',');
  }

  /**
   * 구간 → 판례 모듈 입력 계약 (입출력 바디 형태.pdf)
   *
   * 계약 형태는 그대로다 — 타깃 하나가 메시지 하나에서 구간 하나로 바뀌었을 뿐.
   * targetText는 "1차의 사실 요약 + 구간 원문"이다. 요약은 구어 원문보다 판시사항 문체에
   * 가까워 벡터 검색 질의로 유리하고, 원문은 검색 근거의 손실을 막는다. 문자열 하나라
   * 벡터 모듈 쪽은 손댈 게 없다.
   */
  buildAnalysisTargets(
    input: AnalyzeInput,
    screening: Screening,
  ): AnalysisTarget[] {
    return screening.segments.map((seg) => {
      const lines = seg.messageNos
        .map((no) => input.messages[no - 1])
        .filter((m): m is ChatMessage => !!m && !m.systemEvent)
        .map((m) => m.text);
      return {
        targetMessageId: SafeguardAnalysisService.segmentId(seg.messageNos),
        targetText: [seg.summary, ...lines].join('\n'),
        legalContext: {
          isGroupChat: input.context !== 'dm', //       코드가 채움 (방 정보)
          audienceCount: input.participantCount, //     코드가 채움 (방 정보)
          victimIdentifiable: seg.victimIdentifiable, // 1차 AI가 채움 (특정성)
        },
      };
    });
  }

  /**
   * AI가 낸 메시지 번호 정리 — 범위 밖·중복 제거, 오름차순. 비면 구간 자체를 버린다.
   * (구조화 출력이라 형식은 보장되지만 번호의 실재 여부까지는 스키마가 못 막는다)
   */
  private sanitizeNos(nos: number[], total: number): number[] {
    return [
      ...new Set(
        nos.filter((n) => Number.isInteger(n) && n >= 1 && n <= total),
      ),
    ].sort((a, b) => a - b);
  }

  /** 메시지 한 줄 표기 — 원문 윈도우용 */
  private formatLine(m: ChatMessage, no: number, mark: boolean): string {
    const label = {
      join: '입장',
      leave: '퇴장',
      invite: '초대',
      kick: '강퇴',
      delete: '메시지 삭제',
    };
    const who =
      m.systemEvent === 'delete'
        ? ''
        : `${(m.targets ?? [m.target ?? m.sender]).join(', ')} `;
    const body = m.systemEvent
      ? `<시스템: ${who}${label[m.systemEvent]}>`
      : `${m.sender}: ${m.text}`;
    return `${mark ? '▶' : ' '} [${String(no).padStart(4, '0')}] ${body}`;
  }

  /**
   * 2차 입력 직렬화 — 판례 사전(중복 제거) + 구간별 원문 범위·요약·판례 ID
   *
   * 구간의 첫 발화 앞 1줄부터 마지막 발화 뒤 1줄까지 원문을 통째로 준다.
   * ▶ 표시가 구간 소속 발화, 나머지는 사이의 피해자 응답 등 맥락.
   * 1차의 summary는 해석이라 2차가 끌려갈 수 있어(앵커링) 원문을 함께 주고
   * "요약은 참고일 뿐"으로 못 박는다.
   */
  private judgeContent(
    input: AnalyzeInput,
    screening: Screening,
    matched: PrecedentMatchOutput,
  ): string {
    const byId = new Map(
      matched.analysisTargets.map((t) => [t.targetMessageId, t]),
    );

    const dict = Object.entries(matched.precedentDict)
      .map(([id, gist]) => `${id}: ${gist}`)
      .join('\n');

    const items = screening.segments
      .map((seg) => {
        const t = byId.get(SafeguardAnalysisService.segmentId(seg.messageNos));
        const inSeg = new Set(seg.messageNos);
        const first = Math.min(...seg.messageNos);
        const last = Math.max(...seg.messageNos);
        const from = Math.max(0, first - 2); // 첫 발화 앞 1줄부터
        const to = Math.min(input.messages.length, last + 1); // 마지막 발화 뒤 1줄까지
        const span = input.messages
          .slice(from, to)
          .map((m, i) =>
            this.formatLine(m, from + i + 1, inSeg.has(from + i + 1)),
          )
          .join('\n');
        const label = seg.messageNos
          .map((n) => String(n).padStart(4, '0'))
          .join(',');
        return [
          `[구간 ${label}] 피해자 식별: ${seg.victimIdentifiable ? '예' : '아니오'}` +
            ` · 판례 후보: ${t?.matchedPrecedentIds.join(', ') || '없음'}`,
          span,
          `요약: ${seg.summary}`,
        ].join('\n');
      })
      .join('\n\n');

    return [
      `[대화 정보]`,
      `- 장소: ${this.contextLabel(input.context)} (참여 인원 ${input.participantCount}명)`,
      `- 피해자: ${input.victimName}`,
      `- 관찰된 패턴: ${screening.patterns.join(', ') || '없음'}`,
      ``,
      `[판례 사전 — 벡터 검색 결과]`,
      dict || '(없음)',
      ``,
      `[후보 구간 목록]`,
      items,
    ].join('\n');
  }

  /** 2차 판단 — 판례를 근거로 유형·정도 확정 */
  async judge(
    input: AnalyzeInput,
    screening: Screening,
    matched: PrecedentMatchOutput,
  ): Promise<{ flagged: FlaggedItem[]; patterns: string[] }> {
    const out = await this.callStructured(
      '2차 판단',
      JudgmentResult,
      SYSTEM_JUDGE,
      this.judgeContent(input, screening, matched),
      'medium',
    );
    // 패턴은 대화 전체를 본 1차의 판단을 그대로 쓴다
    return { flagged: out.judged, patterns: screening.patterns };
  }

  /**
   * 전체 파이프라인: 가명화 → 1차 선별 → 판례 매칭 → 2차 판단 → 역치환.
   *
   * - AI·판례 모듈로 나가는 것은 전부 가명화된 입력이다. 실명 매핑은 이 함수 안에만 있다.
   * - patterns는 AI 관찰(의미 기반)과 코드 검출(시스템 이벤트 기반)의 합집합.
   * - trace에 중간 산출물을 남긴다 — "왜 이렇게 판단됐나"를 역추적하는 데 필요.
   */
  async analyze(
    input: AnalyzeInput,
    opts: {
      anonymize?: boolean;
      onStage?: (stage: string, data?: Record<string, number>) => void;
    } = {},
  ): Promise<{
    flagged: FlaggedItem[];
    patterns: string[];
    trace: { screening: Screening; matched: PrecedentMatchOutput | null };
  }> {
    const onStage = opts.onStage ?? (() => {});

    // 코드 패턴 검출은 로컬 연산이라 원본으로 (가명화 불필요)
    onStage('anonymize');
    const codePatterns = this.detectSystemPatterns(
      input.messages,
      input.victimName,
    );

    const { input: masked, map } =
      opts.anonymize === false ? { input, map: {} } : anonymizeInput(input);

    onStage('screen');
    const raw = await this.screen(masked);
    const total = input.messages.length;
    const screening: Screening = {
      patterns: raw.patterns,
      segments: raw.segments
        .map((seg) => ({
          ...seg,
          messageNos: this.sanitizeNos(seg.messageNos, total),
        }))
        .filter((seg) => seg.messageNos.length > 0)
        .sort((a, b) => a.messageNos[0] - b.messageNos[0]),
    };
    onStage('screen_done', {
      candidates: screening.segments.length,
      messages: screening.segments.reduce((n, s) => n + s.messageNos.length, 0),
    });
    const patterns = [...new Set([...screening.patterns, ...codePatterns])];

    const unmaskedScreening: Screening = {
      ...screening,
      segments: screening.segments.map((seg) => ({
        ...seg,
        summary: deanonymize(seg.summary, map),
      })),
    };

    if (screening.segments.length === 0) {
      return {
        flagged: [],
        patterns,
        trace: { screening: unmaskedScreening, matched: null },
      };
    }
    const matched = await this.precedents.match({
      analysisTargets: this.buildAnalysisTargets(masked, screening),
    });
    onStage('match_done', {
      precedents: Object.keys(matched.precedentDict).length,
    });

    onStage('judge');
    const judged = await this.judge(masked, screening, matched);
    const flagged = judged.flagged
      .map((f) => ({
        ...f,
        messageNos: this.sanitizeNos(f.messageNos, total),
        reason: deanonymize(f.reason, map),
      }))
      .filter((f) => f.messageNos.length > 0)
      .sort((a, b) => a.messageNos[0] - b.messageNos[0]);
    onStage('judge_done', { flagged: flagged.length });

    return {
      flagged,
      patterns,
      trace: { screening: unmaskedScreening, matched },
    };
  }

  /** 집계 — 코드가 센다(LLM 아님) */
  aggregate(flagged: FlaggedItem[], messages: ChatMessage[]): Summary {
    const empty: Summary = {
      count: 0,
      typeCounts: {},
      urgentCount: 0,
      attackerCounts: {},
      distinctDays: 0,
      isRepeated: false,
    };
    if (flagged.length === 0) return empty;

    // 시각·발신자는 구간에 속한 메시지 전부에서, 유형·정도는 구간 단위로 센다
    const times = flagged.flatMap((f) =>
      f.messageNos.map((no) => messages[no - 1].time),
    );
    const typeCounts: Record<string, number> = {};
    const attackerCounts: Record<string, number> = {};

    for (const f of flagged) {
      for (const t of f.harmTypes) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      for (const no of f.messageNos) {
        const sender = messages[no - 1].sender;
        attackerCounts[sender] = (attackerCounts[sender] ?? 0) + 1;
      }
    }

    // 반복성: 세션(같은 날) 단위로 셈 — 3시간 내 연속 전송은 1건 (대법원 2023도5814)
    const days = new Set(times.map((t) => t.slice(0, 10)));

    return {
      count: flagged.length,
      start: times.reduce((a, b) => (a < b ? a : b)),
      end: times.reduce((a, b) => (a > b ? a : b)),
      typeCounts,
      attackerCounts,
      urgentCount: flagged.filter((f) => f.severity === '즉시조치').length,
      distinctDays: days.size,
      isRepeated: days.size >= 3, // 서로 다른 날 3회 이상
    };
  }

  /** 문서 생성(#4). legal=false 판단 근거만 / legal=true 관련 조항·절차 포함 */
  buildDocument(
    input: AnalyzeInput,
    result: { flagged: FlaggedItem[]; patterns: string[] },
    summary: Summary,
    legal = false,
  ): string {
    const { messages, context } = input;
    const { flagged, patterns } = result;
    const out: string[] = [];

    // [첫 문단 — 요약]
    const typeSummary = Object.entries(summary.typeCounts)
      .map(([k, v]) => `${k} ${v}회`)
      .join(', ');
    const attackers = Object.entries(summary.attackerCounts)
      .map(([k, v]) => `${k} ${v}회`)
      .join(', ');

    out.push(
      `${summary.start} ~ ${summary.end} 기간 동안 총 ${summary.count}회의 피해가 확인되었습니다.`,
      `· 유형별: ${typeSummary}`,
      `· 발신자별: ${attackers}`,
      `· 즉시 조치가 필요한 건: ${summary.urgentCount}건`,
      `· 서로 다른 ${summary.distinctDays}일에 걸쳐 발생${summary.isRepeated ? ' (반복성 인정 범위)' : ''}`,
    );
    if (patterns.length > 0) {
      out.push(`· 관찰된 집단 괴롭힘 패턴: ${patterns.join(', ')}`);
    }
    out.push('');

    // [본문 — 피해별 항목]
    for (const f of flagged) {
      const srcs = f.messageNos.map((no) => messages[no - 1]);
      const first = srcs[0];
      const last = srcs[srcs.length - 1];
      const senders = [...new Set(srcs.map((m) => m.sender))].join(', ');
      const head =
        srcs.length === 1
          ? `■ ${first.time} · ${first.sender}`
          : `■ ${first.time} ~ ${last.time} · ${senders} (메시지 ${srcs.length}개)`;
      const block = [
        head,
        ...srcs.map((m) =>
          srcs.length === 1
            ? `  "${m.text}"`
            : `  [${m.time.slice(5, 16)}] ${m.sender}: "${m.text}"`,
        ),
        `  · 유형: ${f.harmTypes.join(', ')}`,
        `  · 정도: ${f.severity}`,
      ];

      if (legal) {
        const isDm = context === 'dm';
        const seenArticle = new Set<string>();
        const seenNotice = new Set<string>();

        for (const t of f.harmTypes as string[]) {
          const r = this.laws.resolve(t, isDm);
          if (!r) continue;

          for (const a of r.articles) {
            if (seenArticle.has(a.라벨)) continue;
            seenArticle.add(a.라벨);
            // 형량은 조문 원문에서 추출 — 법이 개정되면 자동 반영
            block.push(`  · 관련 조항: ${this.laws.summarize(a)}`);
          }

          const notice = this.laws.prosecutionNotice(r.meta.prosecution);
          if (!seenNotice.has(notice)) {
            seenNotice.add(notice);
            block.push(`    ※ ${notice}`);
          }
          if (r.meta.note && !seenNotice.has(r.meta.note)) {
            seenNotice.add(r.meta.note);
            block.push(`    ※ ${r.meta.note}`);
          }
        }
      } else {
        block.push(`  · 근거: ${f.reason}`);
      }
      out.push(block.join('\n'), '');
    }

    if (legal) {
      // 삭제 트랙 — 처벌과 별개로 병행 가능
      const fastLaw = this.laws.article(REMOVAL_TRACK.fast.articleKey);
      const officialLaw = this.laws.article(REMOVAL_TRACK.official.articleKey);
      out.push(
        '[게시물 삭제·차단 절차 — 처벌 절차와 별개로 동시에 진행할 수 있습니다]',
        `· 빠른 경로: ${fastLaw?.라벨 ?? '정통망법 제44조의2'}`,
        `  ${REMOVAL_TRACK.fast.how}`,
        `· 공적 경로: ${officialLaw?.라벨 ?? '정통망법 제44조의7'}`,
        `  ${REMOVAL_TRACK.official.how}`,
      );
      out.push('');

      // 공연성 없는 대화에 대한 안내
      if (context === 'dm') {
        out.push(
          '※ 1:1 개인 대화는 공연성(불특정·다수가 인식할 수 있는 상태)이 인정되지 않아 ' +
            '모욕죄·명예훼손죄가 성립하기 어렵습니다. 대신 반복 전송·협박·스토킹 조항으로 검토하였습니다.',
        );
      }
      // 형사 미달 시 민사 트랙 병기
      const civil = CIVIL_TRACK.map((k) => this.laws.article(k)?.라벨).filter(
        Boolean,
      );
      out.push(
        `※ 형사 처벌이 어려운 경우에도 손해배상 청구는 별도로 가능합니다 (${civil.join(' · ')}). ` +
          '위자료는 민법 제751조가 근거이며, 가해자가 미성년자인 경우 제755조에 따라 보호자에게 청구할 수 있습니다. ' +
          '소멸시효는 피해를 안 날부터 3년입니다.',
        '',
        '※ 본 정리는 참고용이며 법률 자문이 아닙니다. ' +
          '정확한 판단은 변호사·대한법률구조공단(132)·청소년 상담 1388에 문의하세요.',
      );
    }
    return out.join('\n');
  }
}
