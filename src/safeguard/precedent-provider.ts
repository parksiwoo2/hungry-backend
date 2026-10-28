/**
 * 판례 매칭 모듈 계약 (입출력 바디 형태)
 *
 * 실제 구현은 팀원 담당 — 판례 문구를 임베딩한 벡터 DB에서
 * targetText와 가장 가까운 판례 문구 3개를 자연어 검색으로 리턴한다.
 * 이 파일은 그 모듈의 입출력 계약을 타입으로 고정한다.
 *
 * 연결 방법: PrecedentProvider 를 구현한 클래스를 PRECEDENT_PROVIDER 토큰으로 제공한다
 * (safeguard-infra.module.ts). 엔진은 이 토큰으로 주입받는다.
 *
 * 계약에서 한 가지 제안: 원안에는 targetMessageId가 출력에만 있는데,
 * 응답 순서 의존을 없애기 위해 입력에도 포함했다. (메시지 번호를 그대로 씀)
 */

/** 판례 매칭 구현의 DI 토큰 — 운영 구현은 safeguard-infra.module.ts 가 정한다 */
export const PRECEDENT_PROVIDER = Symbol('PRECEDENT_PROVIDER');

export interface LegalContext {
  /** 공연성 판단 (1:1 vs 단톡방) */
  isGroupChat: boolean;
  /** 공연성 전파 가능성 인원 */
  audienceCount: number;
  /** 특정성 판단 (피해자 식별 가능 여부) — 1차 AI가 채움 */
  victimIdentifiable: boolean;
}

export interface AnalysisTarget {
  /** 메시지 번호(no). 원안엔 입력에 없으나 순서 의존을 없애려 추가 제안 */
  targetMessageId: string;
  targetText: string;
  legalContext: LegalContext;
  /**
   * 1차가 넉넉히 고른 후보 유형(HarmType). 검색 범위를 죄명으로 좁히는 데만 쓰고
   * 2차 프롬프트에는 넣지 않는다 — 실측에서 사실 유사도만으로는 모욕 구간에 명예훼손
   * 판례가 붙었다(데모 96구간 중 죄명 일치 39건).
   */
  candidateTypes?: string[];
}

export interface PrecedentMatchInput {
  analysisTargets: AnalysisTarget[];
}

export interface PrecedentMatchOutput {
  /** 판례 일련번호 → 사건번호와 요지 한 줄 (전체 결과에서 중복 제거) */
  precedentDict: Record<string, string>;
  /** 입력 순서 그대로 + 메시지당 판례 3개 고정 */
  analysisTargets: (AnalysisTarget & { matchedPrecedentIds: string[] })[];
}

/** 심급별 결론 — guilty 가 null 이면 그 심급이 유무죄를 판단하지 않았거나 기록이 없는 것 */
export interface PrecedentRuling {
  court: string;
  guilty: boolean | null;
}

/**
 * 정리 문서의 "참고 판례" 절에 실을 판례 상세.
 * 요지·참조조문·인용 발언은 판례 원문이고, rulings 만 팀 분석 테이블의 결론 플래그다.
 * AI가 쓴 사실관계·판단 요약 문장은 넣지 않는다 — 문서에 판례 설명처럼 인쇄되면 안 된다.
 */
export interface PrecedentDetail {
  id: string;
  caseNumber: string;
  court: string | null;
  caseName: string | null;
  /** YYYY-MM-DD */
  decidedOn: string | null;
  /** 판시사항 첫 항목 (없으면 판결요지) — 2차 사전과 같은 원문 */
  summary: string | null;
  refLaws: string | null;
  /** 법원이 다룬 발언 — 판결문에서 인용된 원문 */
  quotedTexts: string[];
  rulings: PrecedentRuling[];
}

export interface PrecedentProvider {
  match(input: PrecedentMatchInput): Promise<PrecedentMatchOutput>;
  /** 문서 생성 시점에 호출. 모르는 ID는 빼고 입력 순서로 돌려준다. 실패하면 빈 배열 */
  describe(ids: string[]): Promise<PrecedentDetail[]>;
}

/**
 * 판례를 하나도 매칭하지 않는 구현 — 테스트용이자 벡터 검색 실패 시의 대체 동작.
 *
 * 파이프라인은 그대로 동작한다: 2차 판단 프롬프트가
 * "적합한 판례가 없어도 명백히 유해한 발언은 기준으로 판단하라"를 포함하므로,
 * 판례 없이도 유형·정도 판정은 수행된다. 판례 근거(appliedPrecedentIds)만 비게 된다.
 */
export class NoopPrecedentProvider implements PrecedentProvider {
  match(input: PrecedentMatchInput): Promise<PrecedentMatchOutput> {
    return Promise.resolve({
      precedentDict: {},
      analysisTargets: input.analysisTargets.map((t) => ({
        ...t,
        matchedPrecedentIds: [],
      })),
    });
  }

  describe(): Promise<PrecedentDetail[]> {
    return Promise.resolve([]);
  }
}
