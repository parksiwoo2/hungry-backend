# HTTP API 목록

## 인증·사용자

| 메서드 | 경로           | 설명                               |
| ------ | -------------- | ---------------------------------- |
| POST   | `/auth/signup` | 이메일과 닉네임으로 회원가입       |
| POST   | `/auth/login`  | 이메일로 로그인하고 세션 쿠키 발급 |
| POST   | `/auth/logout` | 현재 로그인 세션 종료              |
| GET    | `/users/me`    | 내 정보 조회                       |
| PATCH  | `/users/me`    | 내 정보 부분 수정                  |
| DELETE | `/users/me`    | 회원탈퇴 및 로그인 세션 삭제       |

## 판례

| 메서드 | 경로                           | 설명                                              |
| ------ | ------------------------------ | ------------------------------------------------- |
| GET    | `/precedent`                   | 외부 API에서 판례 목록 조회                       |
| GET    | `/precedent/:id`               | 외부 API에서 판례 상세 조회                       |
| GET    | `/precedent/stored/categories` | 판례 수집 분류와 검색어 목록 조회                 |
| GET    | `/precedent/stored`            | DB에 저장된 판례 목록 조회                        |
| GET    | `/precedent/stored/:id`        | DB에 저장된 판례 상세 조회                        |
| POST   | `/precedent/search`            | 자연어·키워드 하이브리드 판례 검색                |
| POST   | `/precedent/match`             | 증거 내용과 법적 맥락으로 관련 판례 최대 3개 매칭 |
| GET    | `/precedent/models/:model`     | 판례 관련 모델별 저장 데이터 조회                 |

## 대화 자료

| 메서드 | 경로                       | 설명                                       |
| ------ | -------------------------- | ------------------------------------------ |
| POST   | `/sessions`            | 카카오톡 내보내기 원문 업로드·파싱         |
| GET    | `/sessions/:sessionId` | 업로드 자료의 참여자·기간 등 메타정보 조회 |
| DELETE | `/sessions/:sessionId` | 업로드 자료 삭제                           |

## 분석·보고서·행동 카드

| 메서드 | 경로                                | 설명                                         |
| ------ | ----------------------------------- | -------------------------------------------- |
| POST   | `/analyses`                     | 대화 AI 분석 실행 및 진행 상황·결과 스트리밍 |
| GET    | `/analyses`                     | 저장된 분석 목록 조회                        |
| GET    | `/analyses/:analysisId`         | 분석 상태와 상세 결과 조회                   |
| DELETE | `/analyses/:analysisId`         | 분석 삭제                                    |
| GET    | `/analyses/:analysisId/report`  | 분석 결과 PDF 다운로드                       |
| GET    | `/analyses/:analysisId/actions` | 분석 결과에 맞는 행동 카드 조회              |

## 상담 챗봇

| 메서드 | 경로                  | 설명                                      |
| ------ | --------------------- | ----------------------------------------- |
| POST   | `/chats/intro`    | 분석 결과로 상담 세션 생성 및 인사말 반환 |
| POST   | `/chats/messages` | 상담 메시지 전송 및 AI 답변 반환          |

## 테스트 화면

| 메서드 | 경로 | 설명                  |
| ------ | ---- | --------------------- |
| GET    | `/`  | 테스트용 웹 화면 제공 |

| POST | `/precedent/search` | 자연어·키워드 하이브리드 판례 검색 |
| GET | `/precedent/:id` | 외부 API에서 판례 상세 조회
| POST | `/analyses` | 대화 AI 분석 실행 및 진행 상황·결과 스트리밍 |
| GET | `/analyses` | 저장된 분석 목록 조회 |
| GET | `/analyses/:analysisId` | 분석 상태와 상세 결과 조회 |
| DELETE | `/analyses/:analysisId` | 분석 삭제 |
| GET | `/analyses/:analysisId/report` | 분석 결과 PDF 다운로드 |
| GET | `/analyses/:analysisId/actions` | 분석 결과에 맞는 행동 카드 조회  
| POST | `/sessions` | 카카오톡 내보내기 원문 업로드·파싱 |
| GET | `/sessions/:sessionId` | 업로드 자료의 참여자·기간 등 메타정보 조회 |
| DELETE | `/sessions/:sessionId` | 업로드 자료 삭제 |
| POST | `/chats/intro` | 분석 결과로 상담 세션 생성 및 인사말 반환 |
| POST | `/chats/messages` | 상담 메시지 전송 및 AI 답변 반환 |
