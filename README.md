# HTTP API 목록

요청·응답 예시, 인증, 오류, 업로드 → 분석 → 상담 순서는 [API 상세 명세](API.md)를 참고하세요. 현재 구현 기준이며 배포 실행 방법은 이 문서 아래에 유지합니다.

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

| 메서드 | 경로                            | 설명                                              |
| ------ | ------------------------------- | ------------------------------------------------- |
| GET    | `/precedents`                   | 외부 API에서 판례 목록 조회                       |
| GET    | `/precedents/:precedentId`      | 저장 판례·쟁점·법원 판단 상세 조회                |
| GET    | `/precedents/stored/categories` | 판례 수집 분류와 검색어 목록 조회                 |
| GET    | `/precedents/stored`            | DB에 저장된 판례 목록 조회                        |
| GET    | `/precedents/stored/:id`        | DB에 저장된 판례 상세 조회                        |
| POST   | `/precedents/search`            | 자연어·키워드 하이브리드 판례 검색                |
| POST   | `/precedents/match`             | 증거 내용과 법적 맥락으로 관련 판례 최대 3개 매칭 |
| GET    | `/precedents/models/:model`     | 판례 관련 모델별 저장 데이터 조회                 |

## 대화 자료

| 메서드 | 경로                   | 설명                                       |
| ------ | ---------------------- | ------------------------------------------ |
| POST   | `/sessions`            | 카카오톡 내보내기 원문 업로드·파싱         |
| GET    | `/sessions/:sessionId` | 업로드 자료의 참여자·기간 등 메타정보 조회 |
| DELETE | `/sessions/:sessionId` | 업로드 자료 삭제                           |

## 분석·보고서·행동 카드

| 메서드 | 경로                            | 설명                                         |
| ------ | ------------------------------- | -------------------------------------------- |
| POST   | `/analyses`                     | 대화 AI 분석 실행 및 진행 상황·결과 스트리밍 |
| GET    | `/analyses`                     | 저장된 분석 목록 조회                        |
| GET    | `/analyses/:analysisId`         | 분석 상태와 상세 결과 조회                   |
| DELETE | `/analyses/:analysisId`         | 분석 삭제                                    |
| GET    | `/analyses/:analysisId/report`  | 분석 결과 PDF 다운로드                       |
| GET    | `/analyses/:analysisId/actions` | 분석 결과에 맞는 행동 카드 조회              |

## 상담 챗봇

| 메서드 | 경로              | 설명                                      |
| ------ | ----------------- | ----------------------------------------- |
| POST   | `/chats/intro`    | 분석 결과로 상담 세션 생성 및 인사말 반환 |
| POST   | `/chats/messages` | 상담 메시지 전송 및 AI 답변 반환          |

## 테스트 화면

| 메서드 | 경로                            | 설명                                         |
| ------ | ------------------------------- | -------------------------------------------- |
| GET    | `/`                             | 테스트용 웹 화면 제공                        |
| POST   | `/precedents/search`            | 자연어·키워드 하이브리드 판례 검색           |
| GET    | `/precedents/:precedentId`      | 저장 판례·쟁점·법원 판단 상세 조회           |
| POST   | `/analyses`                     | 대화 AI 분석 실행 및 진행 상황·결과 스트리밍 |
| GET    | `/analyses`                     | 저장된 분석 목록 조회                        |
| GET    | `/analyses/:analysisId`         | 분석 상태와 상세 결과 조회                   |
| DELETE | `/analyses/:analysisId`         | 분석 삭제                                    |
| GET    | `/analyses/:analysisId/report`  | 분석 결과 PDF 다운로드                       |
| GET    | `/analyses/:analysisId/actions` | 분석 결과에 맞는 행동 카드 조회              |
| POST   | `/sessions`                     | 카카오톡 내보내기 원문 업로드·파싱           |
| GET    | `/sessions/:sessionId`          | 업로드 자료의 참여자·기간 등 메타정보 조회   |
| DELETE | `/sessions/:sessionId`          | 업로드 자료 삭제                             |
| POST   | `/chats/intro`                  | 분석 결과로 상담 세션 생성 및 인사말 반환    |
| POST   | `/chats/messages`               | 상담 메시지 전송 및 AI 답변 반환             |

## 배포 서버 실행 (Windows PowerShell)

요청 구조: 모바일 앱 → ngrok HTTPS 주소 → Nest 서버(3000) → Docker PostgreSQL(5432).

Node.js 의존성 설치, Docker Desktop 실행, ngrok 계정 인증, 프로젝트 루트의 `.env` 및 DB 데이터 준비가 완료된 상태를 기준으로 합니다. 아래 명령은 프로젝트 루트에서 실행합니다.

### 1. DB와 Nest 실행 — 터미널 1

로컬 PostgreSQL이 5432 포트를 사용하고 있으면 먼저 중지합니다.

```powershell
$env:DB_PORT = '5432'
docker compose up -d db

npm run build
$env:NODE_ENV = 'production'
$env:PORT = '3000'
$env:DB_HOST = '127.0.0.1'
$env:SESSION_COOKIE_SECURE = 'true'
npm run start:prod
```

Nest가 `.env`를 로드하고 DB 연결 및 미적용 마이그레이션을 실행합니다. 기존 Docker 볼륨의 데이터는 유지됩니다. 코드 변경 후에는 다시 빌드하고 Nest를 재시작합니다.

### 2. 외부 HTTPS 연결 — 터미널 2

```powershell
ngrok http 3000
```

Store판에서 인증하고 winget판으로 실행하는 이 PC에서는 아래 명령으로 같은 인증 설정을 지정할 수 있습니다.

```powershell
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe" http 3000 --config "$env:LOCALAPPDATA\Packages\ngrok.ngrok_1g87z0zv29zzc\LocalCache\Local\ngrok\ngrok.yml"
```

두 명령 중 설치 환경에 맞는 하나만 실행합니다. 터미널에 표시되는 `Forwarding`의 HTTPS 주소를 앱의 API Base URL로 설정합니다.

### 3. 앱 연결 설정

- API Base URL: `https://dropkick-unclaimed-upscale.ngrok-free.dev` (실행 시 Forwarding 주소 확인)
- 요청 예: `POST {Base URL}/precedents/search`, `POST {Base URL}/sessions`, `POST {Base URL}/analyses`
- 경로에 `/api`를 붙이지 않습니다. 실제 기기의 `localhost`는 기기 자신이므로 서버 주소로 사용하지 않습니다.
- JSON 요청은 `Content-Type: application/json`을 사용합니다. ngrok 안내 HTML을 방지하려면 `ngrok-skip-browser-warning: true` 헤더를 추가합니다.
- 로그인 응답의 `Set-Cookie`를 앱 HTTP 클라이언트의 쿠키 저장소에 보관하고, 이후 같은 서버 요청에 쿠키를 전송합니다. HTTPS용 세션 쿠키를 사용하므로 HTTPS Base URL을 유지합니다.
- `POST /analyses` 응답은 NDJSON 스트림입니다. 줄 단위로 JSON을 읽고 마지막 `type: "result"` 또는 `type: "error"`를 처리합니다. HTTP 201만으로 분석 성공을 판단하지 않습니다.
- 네이티브 앱의 HTTP 클라이언트에는 브라우저 CORS 제한이 적용되지 않습니다. WebView나 웹 앱에서 다른 origin으로 호출한다면 별도 CORS·쿠키 설정 검토가 필요합니다.

PC, Docker, Nest, ngrok이 모두 실행 중이어야 외부 요청을 받을 수 있습니다. 회원가입·로그인·로그아웃 외 기능 API는 세션 로그인이 필요합니다. 판례는 로그인 사용자 공용이며, 업로드 자료·분석·보고서·행동 카드·상담은 본인 데이터만 접근할 수 있습니다. 비로그인은 401, 타인 또는 소유자 없는 데이터는 404입니다.

기존 자료·분석은 소유자를 추측해 배정하지 않으므로 마이그레이션 후 일반 API에서 조회되지 않습니다. 회원탈퇴 시 소유권이 해제되어 해당 자료와 연결된 상담에 접근할 수 없습니다. 현재 이메일만으로 로그인하는 시연용 방식은 유지되므로 이메일 소유권 검증까지 제공하는 것은 아닙니다.

### 4. 종료

ngrok과 Nest 터미널에서 각각 `Ctrl+C`를 누릅니다. DB까지 중지할 때는 다음 명령을 실행합니다.

```powershell
docker compose stop db
```

DB 데이터를 유지하려면 `docker compose down -v`는 실행하지 않습니다.
