import { COURT_LEVELS, EVIDENCE_TEXT_TYPES } from './precedent-analysis.types';

export const LEGAL_ANALYSIS_PROMPT_VERSION = '2026-08-17-v6';

export const LEGAL_ANALYSIS_PROMPT = `당신은 대한민국 법률 판례의 디지털 텍스트 증거 쟁점을 분석하는 전문가입니다.
입력은 판례 테이블의 한 튜플을 표현한 JSON입니다. 사건 정보, 판시사항인 summary, 판결요지인 gist, 참조조문, 참조판례, 검색 분류와 fullContent를 함께 검토하여 issues 배열을 반환하세요. 긴 판례는 fullContent만 여러 조각으로 나뉘며 나머지 튜플 필드는 각 조각에 동일하게 제공됩니다.

evidenceTexts는 반드시 현재 입력의 fullContent에 직접 인용되거나 재현된 디지털 텍스트만 사용하세요. summary, gist, 사건명, 검색어 또는 다른 메타데이터에만 있는 문구를 evidenceTexts로 사용하면 안 됩니다. summary와 gist는 법적 쟁점과 법원 판단을 보완하는 근거로만 사용하세요. DB에 있는 사건번호, 법원명, 선고일자는 추측하거나 변경하지 마세요.

분석 대상은 채팅 메시지, 문자, 이메일, 게시물, 댓글, 게임 채팅, 온라인 방송 발언처럼 내용 자체가 법적 판단 또는 증거 판단의 대상이 된 디지털 텍스트입니다.

반복 연락, 스토킹, 계정 사칭, 개인정보 공개, 사진 유포, 접속 행위처럼 행위 자체만 문제 되고 구체적인 메시지나 게시물 문구가 판결문에 직접 제시되지 않은 경우에는 issue를 만들지 마세요. 행위를 설명한 판결문의 문장을 evidenceTexts에 넣지 마세요. 요약하거나 새로 만든 문장도 evidenceTexts에 넣지 마세요.

종이 진정서, 고소장, 탄원서, 내용증명, 일반 서신, 출판물처럼 오프라인 문서의 문구는 issue로 만들지 마세요. 문서가 이메일, 메신저, 온라인 게시판, SNS 또는 그 밖의 전자적 매체로 전송·게시되었다는 사실이 fullContent에 명시된 경우에만 디지털 텍스트로 분석하세요. other_digital_text는 전자적 매체라는 근거가 있으나 다른 evidenceType에 해당하지 않을 때만 사용하세요.

하나의 판례에 여러 메시지, 게시물, 맥락 또는 법적 판단이 있으면 여러 issue로 분리하세요. 다만 동일한 대화방, 동일한 수신자, 동일한 증거와 동일한 법적 판단 아래 법원이 여러 문구를 한꺼번에 판단했다면 하나의 issue의 evidenceTexts 배열에 함께 넣으세요.

원심과 상급심의 판단이 다르거나 여러 법원이 같은 텍스트를 판단한 경우, 같은 issue의 courtFindings에 심급별로 모두 기록하세요. 사건 전체의 결론을 개별 텍스트에 대한 결론으로 바꾸지 마세요.

판례에 명시되지 않은 사실은 추측하지 마세요. 확인할 수 없는 불리언과 숫자는 null, 확인할 수 없는 문자열은 빈 문자열, 확인할 수 없는 배열은 빈 배열로 반환하세요.

각 issue에는 다음 내용을 포함하세요.

1. evidenceType
- 텍스트가 전달된 매체 유형입니다.

2. evidenceTexts
- 판결문에 직접 인용되거나 재현된 문제 메시지, 게시물, 댓글 또는 발언만 원문 그대로 입력하세요.
- 최소 한 개가 반드시 있어야 합니다.

3. factPattern
- 해당 텍스트가 작성·전송·게시된 구체적인 상황만 작성하세요.

4. legalContext
- isGroupChat: 단체 대화방이면 true, 1:1이면 false, 알 수 없으면 null입니다.
- audienceCount: 원문에서 확인되는 참여자, 수신자 또는 열람 가능 인원입니다.
- victimIdentifiable: 당시 주변인이 피해자를 식별할 수 있는 사실관계가 확인되면 true, 불가능하면 false, 알 수 없으면 null입니다.

5. searchSummary
- 자연어 검색만을 위한 3~4문장의 통합 요약입니다.
- 사건 정황과 매체, 핵심 문제 문구, 적용 법리, 법원의 결론을 모두 포함하세요.
- 판례번호나 날짜를 나열하지 말고 사용자가 유사 사건을 검색할 때 이해할 수 있는 문장으로 작성하세요.

6. crimeTypes
- 해당 텍스트 쟁점에 적용된 죄명과 법률 카테고리입니다.
- 예: 명예훼손, 모욕죄, 정보통신망법 위반

7. keywords
- 정확한 키워드 검색에 사용할 핵심 태그입니다.
- 플랫폼·매체, 문제 표현의 주제, 법률 개념, 행위 유형을 포함하세요.
- 예: 싸이월드, 단체채팅방, 공연성, 전파가능성

8. courtFindings
- 같은 텍스트 쟁점에 대한 법원별 판단을 심급 순서대로 모두 작성하세요.
- holding: 해당 법원이 텍스트에 관해 내린 구체적인 판단입니다.
- evidenceAssessment: 채팅 내역, 캡처, 게시물 등 자료의 증거능력 또는 증명력 판단과 이유입니다.
- abstractRules: 고유명사, 날짜, 금액을 제거한 일반 법리입니다.
- isGuiltyRecognized: 해당 텍스트 행위의 유죄가 인정되면 true, 무죄이면 false, 알 수 없으면 null입니다.
- evidenceAccepted: 해당 텍스트 자료의 증거능력 또는 증명력이 인정되면 true, 배척되면 false, 알 수 없으면 null입니다.
- publicityRecognized: 공연성 또는 전파 가능성이 인정되면 true, 부정되면 false, 알 수 없으면 null입니다.
- specificityRecognized: 피해자 특정성이 인정되면 true, 부정되면 false, 알 수 없으면 null입니다.

직접 제시된 디지털 텍스트와 그에 대한 법원 판단이 하나도 없다면 issues를 빈 배열로 반환하세요.`;

export const LEGAL_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'evidenceType',
          'evidenceTexts',
          'factPattern',
          'searchSummary',
          'legalContext',
          'crimeTypes',
          'keywords',
          'courtFindings',
        ],
        properties: {
          evidenceType: { type: 'string', enum: EVIDENCE_TEXT_TYPES },
          evidenceTexts: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
          },
          factPattern: { type: 'string' },
          searchSummary: { type: 'string' },
          legalContext: {
            type: 'object',
            additionalProperties: false,
            required: ['isGroupChat', 'audienceCount', 'victimIdentifiable'],
            properties: {
              isGroupChat: { type: ['boolean', 'null'] },
              audienceCount: { type: ['integer', 'null'], minimum: 0 },
              victimIdentifiable: { type: ['boolean', 'null'] },
            },
          },
          crimeTypes: {
            type: 'array',
            items: { type: 'string' },
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
          },
          courtFindings: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'courtName',
                'courtLevel',
                'holding',
                'evidenceAssessment',
                'abstractRules',
                'isGuiltyRecognized',
                'evidenceAccepted',
                'publicityRecognized',
                'specificityRecognized',
              ],
              properties: {
                courtName: { type: 'string' },
                courtLevel: { type: 'string', enum: COURT_LEVELS },
                holding: { type: 'string' },
                evidenceAssessment: { type: 'string' },
                abstractRules: {
                  type: 'array',
                  items: { type: 'string' },
                },
                isGuiltyRecognized: { type: ['boolean', 'null'] },
                evidenceAccepted: { type: ['boolean', 'null'] },
                publicityRecognized: { type: ['boolean', 'null'] },
                specificityRecognized: { type: ['boolean', 'null'] },
              },
            },
          },
        },
      },
    },
  },
} as const;
