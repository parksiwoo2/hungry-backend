# 프론트 연동 API 명세

기준: 2026-10-30 현재 구현. 예시의 ID와 데이터는 설명용이며 실제 응답으로 받은 ID를 사용합니다. 배포 서버가 같은 코드를 실행하는지는 별도 확인이 필요합니다.

## 1. 공통 규칙

- Base URL 뒤에 아래 경로를 붙입니다. Nest 경로에는 `/api` 접두사가 없습니다.
- JSON 요청: `Content-Type: application/json`.
- 회원가입·로그인·로그아웃 외 기능 API는 로그인 쿠키 `hungry.sid`가 필요합니다.
- 로그인 응답의 `Set-Cookie`를 보관하고 이후 요청에 전송합니다. Bearer JWT 방식이 아닙니다.
- 판례는 로그인 사용자 공용입니다. 업로드·분석·보고서·행동 카드·상담은 본인 데이터만 접근합니다.
- 비로그인은 401, 없는 데이터나 타인의 데이터는 404입니다.
- DTO 요청에서 정의하지 않은 필드는 400입니다. 특히 상담 메시지에 `analysisId`, `chatHistory`를 보내지 않습니다.
- 날짜·시각은 문자열로 반환합니다. 원문 메시지 시각은 시간대 없는 문자열일 수 있습니다.
- 아래 JSON 예시는 주석 없는 유효 JSON입니다. 생략한 필드는 표에서 설명합니다.

### 식별자 구분

| 이름 | 의미 |
| --- | --- |
| 업로드 `sessionId` | `ses_...`: TXT 파싱 자료 ID |
| `analysisId` | `ana_...`: 분석 실행 결과 한 건 |
| 상담 `sessionId` | UUID: `POST /chats/intro`가 반환하는 상담 ID |
| `precedentId`, `externalId` | 외부 판례 일련번호 문자열. 사건번호가 아님 |
| `caseNumber` | 표시용 사건번호. 여러 사건번호가 포함될 수 있음 |
| `utteranceId` | `utt_...`: 분석된 문제 구간 ID |
| `issueId` | 판례에서 추출한 쟁점 UUID |

## 2. 인증·회원

| 메서드 | 경로 | 요청 | 성공 |
| --- | --- | --- | --- |
| POST | `/auth/signup` | `{ "email": "demo@example.com", "nickName": "몽이" }` | 201, 사용자 정보 |
| POST | `/auth/login` | `{ "email": "demo@example.com" }` | 200, 사용자 정보 + 세션 쿠키 |
| POST | `/auth/logout` | body 없음 | 204, 세션 종료 |
| GET | `/users/me` | body 없음 | 200, 사용자 정보 |
| PATCH | `/users/me` | 아래 수정 필드 중 하나 이상 | 200, 사용자 정보 |
| DELETE | `/users/me` | body 없음 | 204 |

사용자 정보 공통 응답:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "demo@example.com",
  "nickName": "몽이",
  "maskingIcon": "NONE",
  "hasSecretPassword": false
}
```

- 현재 로그인은 이메일만 사용하는 시연용 방식이며 이메일 인증 절차는 없습니다.
- 회원가입은 로그인 쿠키를 발급하지 않습니다. 이후 로그인합니다.
- 이메일·닉네임은 각각 unique이며 중복은 409입니다.
- PATCH 허용 필드: `email`, `nickName`, `maskingIcon`, `secretPassword`.
- `maskingIcon`: `NONE | NOTE | CALCU`. NOTE/CALCU를 보내면 `secretPassword`도 필수입니다.
- 비밀 비밀번호는 6~128자이며 로그인 비밀번호가 아닙니다. 응답에 비밀번호나 해시를 반환하지 않습니다.
- NONE으로 변경할 때 비밀번호를 생략할 수 있지만, 기존 비밀번호를 지우는 동작은 아닙니다.

## 3. TXT 업로드·파싱

### POST /sessions — 201

현재 파일 첨부(multipart)가 아니라 TXT 내용을 JSON 문자열로 전송합니다. 프론트에서는 `await file.text()`로 읽고 `JSON.stringify({ rawText, source: "kakao_export" })`로 직렬화합니다. 문자열 안 실제 개행은 JSON에서 `\n`으로 표현해야 합니다.

```json
{
  "source": "kakao_export",
  "rawText": "학급 님과 카카오톡 대화\n저장한 날짜 : 2026-10-13 22:05:17\n\n--------------- 2026년 9월 1일 화요일 ---------------\n[민준] [오후 5:02] 내일 빵 사와\n[윤아] [오후 5:03] 싫어"
}
```

- `rawText`: 필수, 비어 있지 않은 문자열.
- `source`: 선택, 현재 `kakao_export`만 허용.
- 서버 JSON body 한도는 5MB입니다.
- 지원하지 않는 카카오톡 내보내기 형식은 400입니다.
- 이 요청은 파싱·저장만 합니다. AI 분석은 별도 요청입니다.

```json
{
  "sessionId": "ses_example",
  "source": "kakao_export",
  "format": "kakao_pc",
  "messageCount": 2,
  "systemEventCount": 0,
  "participants": [
    { "name": "민준", "messageCount": 1 },
    { "name": "윤아", "messageCount": 1 }
  ],
  "period": { "from": "2026-09-01T17:02", "to": "2026-09-01T17:03" },
  "analysisIds": [],
  "createdAt": "2026-10-30T00:00:00.000Z"
}
```

`format`: `kakao_pc | kakao_mobile_dm | kakao_mobile_group`. `period`는 null일 수 있습니다.
`messageCount`에는 시스템 이벤트가 포함되며 참여자별 건수에는 제외됩니다.
업로드 응답의 `analysisIds: []`는 정상입니다.

### GET /sessions/:sessionId — 200

같은 세션 응답 형식으로 메타데이터를 조회합니다. 분석 실행 후 다시 조회하면 연결된 `analysisIds`가 들어옵니다. 전체 메시지 원문은 이 API에서 반환하지 않습니다.

### DELETE /sessions/:sessionId — 204

연결된 분석이 있으면 409입니다. 분석을 먼저 삭제해야 합니다.

## 4. 대화 분석

### POST /analyses — 201, NDJSON 스트림

```json
{
  "sessionIds": ["ses_example"],
  "context": "large_group",
  "victimName": "윤아"
}
```

- `sessionIds`: 필수, 현재 한 번에 1개만 지원.
- `context`: `dm | small_group | large_group | public`.
- `victimName`: 업로드 자료의 참여자 이름과 일치해야 합니다.
- 참여자 수는 서버가 자료에서 계산합니다.
- 실행마다 새로운 분석 ID를 생성하므로 한 사용자가 여러 번 분석할 수 있습니다.
- 요청에 `Accept: application/x-ndjson`을 지정할 수 있습니다.

응답은 JSON 배열이 아니라 줄마다 독립 JSON입니다.

```json
{"type":"stage","stage":"anonymize"}
{"type":"stage","stage":"screen"}
{"type":"stage","stage":"screen_done","candidates":3,"messages":8}
{"type":"stage","stage":"match_done","precedents":4}
{"type":"stage","stage":"judge"}
{"type":"stage","stage":"judge_done","flagged":2}
```

마지막 성공 이벤트는 `{ "type": "result", ...분석상세 }`입니다.
실패 이벤트는 아래 형식입니다.

```json
{"type":"error","analysisId":"ana_example","message":"분석에 실패했습니다"}
```

- HTTP 201만으로 성공 처리하지 말고 마지막 이벤트를 확인합니다.
- 후보가 없으면 일부 단계는 생략될 수 있습니다.
- `match_done.precedents`는 전체 후보 판례의 중복 제거 개수입니다.
- 판례 검색 실패 시 판례 없이 분석을 계속할 수 있습니다.

### GET /analyses?limit=20&offset=0 — 200

본인 분석 목록입니다. `limit` 기본 20, 최대 100. `offset`은 건너뛸 결과 수입니다.

```json
{
  "analyses": [
    {
      "analysisId": "ana_example",
      "status": "done",
      "createdAt": "2026-10-30T00:00:00.000Z",
      "context": "large_group",
      "victimName": "윤아",
      "utteranceCount": 1,
      "urgentCount": 1,
      "patterns": ["셔틀"]
    }
  ]
}
```

### GET /analyses/:analysisId — 200

본인 분석 한 건의 상세입니다. 스트리밍용 `type` 필드는 없습니다.

```json
{
  "analysisId": "ana_example",
  "status": "done",
  "error": null,
  "createdAt": "2026-10-30T00:00:00.000Z",
  "finishedAt": "2026-10-30T00:01:00.000Z",
  "sessionIds": ["ses_example"],
  "context": "large_group",
  "participantCount": 5,
  "victimName": "윤아",
  "utterances": [
    {
      "utteranceId": "utt_example",
      "sessionId": "ses_example",
      "messageNos": [32],
      "harmTypes": ["협박"],
      "severity": "즉시조치",
      "reason": "거절한 상대에게 해악을 고지한 구간",
      "appliedPrecedentIds": ["239161"],
      "excluded": false,
      "messages": [
        { "no": 32, "time": "2026-09-01T17:02", "sender": "민준", "text": "안 가져오면 가만 안 둔다" }
      ]
    }
  ],
  "patterns": [],
  "summary": {
    "total": 1,
    "urgentCount": 1,
    "typeCounts": { "협박": 1 },
    "attackerCounts": { "민준": 1 },
    "distinctDays": 1,
    "isRepeated": false,
    "period": { "from": "2026-09-01T17:02", "to": "2026-09-01T17:02" }
  },
  "precedents": {
    "239161": "예시 법원 예시 사건번호: 판례 요지"
  },
  "actionIds": ["CARD_EMERGENCY_REPORT"]
}
```

- `status`: `running | done | error`. 진행 중·실패 시 `summary`, `finishedAt` 등은 null일 수 있습니다.
- `utterances`: 의심·문제 구간 배열. 구간은 단독 메시지 또는 같은 행위의 메시지 묶음입니다.
- `harmTypes`: 언어폭력, 명예훼손, 모욕, 성희롱, 협박, 스토킹, 집단따돌림, 갈취강요.
- `severity`: 관찰, 주의, 즉시조치. 증거능력 점수가 아닌 피해 심각도·조치 수준입니다.
- `messageNos`: 시스템 이벤트를 포함한 원문 항목의 1부터 시작하는 번호.
- `messages`: 해당 번호의 원문을 서버가 결합합니다.
- `appliedPrecedentIds`: 해당 구간에 실제 적용한 외부 판례 일련번호. 사건번호가 아니며 없으면 [].
- `precedents`: 적용된 판례만 중복 제거한 사전. 키는 일련번호, 값은 법원·사건번호·요지 문자열입니다. 분석 당시 저장값이며 요지는 첫 항목 최대 200자로 제한됩니다.
- 구간별 검색 후보 최대 3개 전체는 이 응답에 보존되지 않습니다. 실제 적용 판례만 반환합니다.
- `summary.total`: 문제 구간 수. `attackerCounts`: 발신자별 문제 구간에 포함된 메시지 수.
- `isRepeated`: 서로 다른 날짜가 3일 이상이면 true인 코드 집계입니다.
- `excluded` 필드는 있으나 현재 구간 제외 상태를 변경하는 공개 API는 없습니다.
- `actionIds`는 조회 시 규칙으로 선정합니다. 위 예시는 구조 설명용입니다.

### DELETE /analyses/:analysisId — 204

본인 분석을 삭제합니다. 연결된 상담 세션·메시지도 삭제됩니다. 원본 업로드 자료는 별도로 삭제합니다.

### GET /analyses/:analysisId/report — 200

`Content-Type: application/pdf`로 PDF 바이너리를 반환합니다. JSON이 아닙니다.
본인 분석만 가능하며 완료되지 않은 분석은 409입니다.
현재 `legal` 쿼리는 컨트롤러에서 받지만 보고서 내용을 분기하지 않으므로 생략합니다.

### GET /analyses/:analysisId/actions — 200

경로는 복수형 `actions`입니다. `/action`은 없는 경로입니다.

```json
{
  "actions": [
    {
      "id": "CARD_BACKUP_EVIDENCE",
      "tier": 1,
      "priority": 11,
      "title": "대화 내용 백업/캡처해두기",
      "description": "대화 기록을 보관하도록 안내하는 문구"
    }
  ]
}
```

카드가 없으면 `{ "actions": [] }`이며 404가 아닙니다.
`Cannot GET ...`은 경로 오류, `분석 없음`은 없는 분석 또는 본인 소유가 아닌 분석입니다.

## 5. 상담 챗봇

### POST /chats/intro — 200

```json
{ "analysisId": "ana_example" }
```

본인의 완료된 분석으로 새 상담 세션을 생성합니다. 미완료 분석은 409입니다.

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "greeting": "지금 마음 상태는 어떠신가요?"
}
```

인사말 AI 호출 실패 시 기본 인사말로 세션을 생성할 수 있습니다.
같은 분석으로 다시 intro를 호출하면 새 상담 세션이 생성됩니다.

### POST /chats/messages — 200

```json
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "userMessage": "내일 학교에 가는 게 불안해요."
}
```

- `sessionId`: intro 응답의 상담 UUID. 업로드 ID인 `ses_...`가 아닙니다.
- `userMessage`: 앞뒤 공백 제거 후 비어 있지 않아야 하며 최대 2,000자.
- `analysisId`, `chatHistory`는 요청에 넣지 않습니다.
- 서버가 상담 세션으로 본인 분석을 확인하고 최근 상담 메시지 최대 40개를 DB에서 조회합니다.
- 분석 요약·상담 지침 + 기존 상담 이력 + 새 메시지를 AI에 전달합니다.
- 현재 분석 맥락은 피해자 이름, 장소, 유형, 최대 심각도, 패턴, 가해자 수, 기간·반복성입니다. 문제 발언 원문·reason·판례 전문을 상담 프롬프트에 넣지는 않습니다.

```json
{
  "reply": "그 상황을 다시 마주칠 생각에 불안하셨겠어요.",
  "isCrisis": false,
  "emergencyContacts": null,
  "fallback": false
}
```

| 필드 | 설명 |
| --- | --- |
| reply | 답변 문자열 |
| isCrisis | 위기 감지 여부 |
| emergencyContacts | 일반 응답 null, 위기 시 `{ name: string, tel: string }[]` |
| fallback | 일반 AI 실패로 저장 없이 고정 안내를 반환한 경우 true |

- 정상 응답은 사용자 메시지와 AI 답변을 함께 저장합니다.
- `fallback: true`인 일반 실패는 저장하지 않아 재시도할 수 있습니다.
- 위기 시 고정 답변을 사용해도 저장·종료까지 처리한 경우 fallback은 false입니다.
- 위기로 종료된 상담 재요청은 409이며 연락처 정보를 포함합니다.
- 동시 전송으로 메시지 순번이 충돌해도 409일 수 있습니다.

## 6. 판례 검색·상세

모든 판례 경로는 `/precedents`입니다. 이전 단수 `/precedent` 경로는 지원하지 않습니다.

### POST /precedents/search — 201

```json
{ "query": "단톡방에서 친구를 모욕한 사례", "limit": 10, "offset": 0 }
```

- query: 1~5,000자. limit: 1~20, 기본 10. offset: 0 이상, 기본 0.
- 현재 요청 옵션으로 `mode`(hybrid 기본, summary/fact/rule)와 `filters`(caseNumber, crimeTypes, keywords)도 지원합니다. 일반 검색은 생략합니다.
- 응답에서는 `mode`, `filters`, `score`를 제거했습니다. 내부 점수 계산·정렬은 유지합니다.

응답은 `{ query: string, results: SearchResult[] }`입니다.

| SearchResult 필드 | 타입 |
| --- | --- |
| precedentId, issueId | string |
| issueOrder | number |
| caseNumber, caseName, courtName, judgementDate | string 또는 null |
| searchSummary, evidenceType, factPattern | string |
| evidenceTexts, crimeTypes, keywords | string[] |
| legalContext | { isGroupChat: boolean 또는 null, audienceCount: number 또는 null, victimIdentifiable: boolean 또는 null } |
| courtFindings | 아래 법원 판단 내용 배열. 검색에서는 id·issueId·findingOrder·생성/수정 시각 제외 |

다음 페이지는 offset을 limit만큼 증가시킵니다. 전체 건수·hasMore는 반환하지 않으며 results가 limit보다 적으면 마지막 페이지로 처리할 수 있습니다.

### GET /precedents/:precedentId — 200

외부 API 호출이 아니라 저장 DB에서 아래 구조를 반환합니다.

```json
{
  "precedent": {
    "externalId": "239161",
    "caseNumber": "2023도1234, 2023초기1588",
    "caseName": "예시 사건명",
    "courtName": "대법원",
    "courtTypeCode": "400201",
    "judgementDate": "20240314",
    "sentenceType": "선고",
    "caseType": "형사",
    "caseTypeCode": "400102",
    "judgementType": "판결",
    "dataSource": "대법원",
    "summary": "판시사항",
    "gist": "판결요지",
    "refLaws": "관련 조문",
    "refCases": "관련 판례",
    "fullContent": "판례 원문 전체",
    "matchedCategories": ["모욕"],
    "matchedQueries": ["단체 채팅방 모욕"],
    "detailStatus": "json",
    "detailError": null,
    "detailFetchedAt": "2026-08-14T08:36:40.140Z",
    "createdAt": "2026-08-14T08:28:14.101Z",
    "updatedAt": "2026-08-14T08:59:22.030Z"
  },
  "issues": [
    {
      "id": "75a2f5eb-0930-49fd-91a9-1c1493810b32",
      "precedentId": "239161",
      "issueOrder": 1,
      "evidenceType": "group_chat_message",
      "evidenceTexts": ["문제가 된 발언"],
      "factPattern": "해당 발언이 나온 사실관계",
      "searchSummary": "검색용 쟁점 요약",
      "isGroupChat": true,
      "audienceCount": 8,
      "victimIdentifiable": true,
      "crimeTypes": ["모욕"],
      "keywords": ["단체 대화방"],
      "createdAt": "2026-08-17T07:29:48.030Z",
      "updatedAt": "2026-08-17T07:29:48.030Z",
      "courtFindings": [
        {
          "id": "da0b918e-0000-4000-8000-000000000002",
          "issueId": "75a2f5eb-0930-49fd-91a9-1c1493810b32",
          "findingOrder": 1,
          "courtName": "대법원",
          "courtLevel": "supreme",
          "holding": "법원의 판단",
          "evidenceAssessment": "증거에 관한 판단",
          "abstractRules": ["일반화된 법리"],
          "isGuiltyRecognized": true,
          "evidenceAccepted": true,
          "publicityRecognized": true,
          "specificityRecognized": true,
          "createdAt": "2026-08-17T07:29:48.030Z",
          "updatedAt": "2026-08-17T07:29:48.030Z"
        }
      ]
    }
  ]
}
```

- 판례 문자열 정보와 상세 수집 시각·오류는 저장값에 따라 null일 수 있습니다.
- 법적 맥락의 boolean/인원과 법원 판단의 boolean은 null일 수 있습니다. null을 false로 해석하지 않습니다.
- 쟁점은 issueOrder, 법원 판단은 findingOrder 오름차순입니다.
- 판례 없음: 404. 숫자가 아닌 ID: 400. 쟁점 없음: issues []. 판단 없음: courtFindings [].
- score, 분석 임베딩, rawDetailHtml은 상세 응답에 포함하지 않습니다.

## 7. 기타 판례 API

| 메서드 | 경로 | 요청·역할 |
| --- | --- | --- |
| GET | /precedents | 외부 목록. query 기본 *, search 기본 1, display 기본 10, page 기본 1, sort 기본 ddes |
| GET | /precedents/stored/categories | 수집 분류와 검색어: [{ category, queries }] |
| GET | /precedents/stored | 저장 목록. page 기본 1, limit 기본 20, 선택 category/query |
| GET | /precedents/stored/:id | 기존 평탄한 저장 상세. 위의 precedent+issues 응답과 다르므로 신규 상세 화면에서는 /precedents/:precedentId 사용 |
| POST | /precedents/match | 아래 증거 대상마다 최대 3개 판례 매칭. 성공 201 |
| GET | /precedents/models/:model | 모델 조회. page 기본 1, limit 기본 10, 선택 precedentId/issueId |

매칭 요청 예시:

```json
{
  "analysisTargets": [
    {
      "targetText": "단체 대화방에서 나를 지칭해 비하한 발언",
      "legalContext": {
        "isGroupChat": true,
        "audienceCount": 8,
        "victimIdentifiable": true
      }
    }
  ]
}
```

매칭 응답: `{ retrievalOnly: true, analysisTargets: [{ targetText, legalContext, matches }] }`.
matches에는 판례 ID·쟁점 ID·사건 정보·evidenceType·evidenceTexts·factPattern·searchSummary·legalContext·crimeTypes·keywords·courtFindings·score를 반환합니다.
검색 응답에서 score를 제거한 변경은 이 매칭 API에는 적용되지 않습니다.

model 허용값: precedents, precedent-analyses, precedent-analysis-issues, precedent-issue-findings, precedent-issue-embeddings, precedent-search-documents.
모델 응답: `{ model, entity, table, totalCount, page, limit, items }`.

## 8. 정상 테스트 순서와 흔한 오류

1. 회원가입(필요 시) → 로그인 후 쿠키 유지.
2. POST /sessions → 업로드 sessionId와 참여자 확인.
3. POST /analyses → 해당 업로드 ID와 피해자 지정 → 마지막 result 확인.
4. GET /analyses/:analysisId → 본인 상세 확인.
5. GET /analyses/:analysisId/actions 또는 /report.
6. POST /chats/intro → 상담 UUID 확인.
7. POST /chats/messages → 상담 UUID와 새 메시지만 전송.

| 현상 | 확인 사항 |
| --- | --- |
| 업로드 400 | rawText 안 실제 개행을 JSON 이스케이프했는지, 카카오톡 형식인지 |
| analysisIds가 [] | 업로드는 분석이 아님. 분석 실행 후 세션을 다시 조회 |
| 상담 400 | analysisId/chatHistory가 아니라 상담 sessionId/userMessage인지 |
| 행동 카드 404 | action이 아니라 actions인지, 실제 본인 분석 ID인지 |
| 기능 API 401 | 로그인 쿠키가 전송되는지 |
| 분석 HTTP 201인데 실패 | 마지막 NDJSON 이벤트가 result인지 error인지 |

