/**
 * 판례 매칭 모듈 계약 (입출력 바디 형태)
 *
 * 실제 구현은 팀원 담당 — 판례 문구를 임베딩한 벡터 DB에서
 * targetText와 가장 가까운 판례 문구 3개를 자연어 검색으로 리턴한다.
 * 이 파일은 그 모듈의 입출력 계약을 타입으로 고정한다.
 *
 * 연결 방법: PrecedentProvider 를 구현한 클래스를 만들고
 * SafeguardAnalysisService 의 precedents 필드를 교체하면 된다.
 *
 * 계약에서 한 가지 제안: 원안에는 targetMessageId가 출력에만 있는데,
 * 응답 순서 의존을 없애기 위해 입력에도 포함했다. (메시지 번호를 그대로 씀)
 */

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
}

export interface PrecedentMatchInput {
  analysisTargets: AnalysisTarget[];
}

export interface PrecedentMatchOutput {
  /** 사건번호 → 요지 한 줄 (전체 결과에서 중복 제거된 사전) */
  precedentDict: Record<string, string>;
  /** 입력 순서 그대로 + 메시지당 판례 3개 고정 */
  analysisTargets: (AnalysisTarget & { matchedPrecedentIds: string[] })[];
}

export interface PrecedentProvider {
  match(input: PrecedentMatchInput): Promise<PrecedentMatchOutput>;
}

/**
 * 벡터 DB 모듈이 연결되기 전까지의 자리표시자 — 판례를 하나도 매칭하지 않는다.
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
}
