# 테스트

```bash
npm test -- --runInBand
```

단위 테스트이며 DB나 외부 AI API에 연결하지 않습니다.

```bash
npm run test:postgres
```

별도 PostgreSQL 컨테이너를 127.0.0.1:15432에 시작하고 통합/e2e 테스트를 실행합니다.
프로젝트 .env를 로딩하지 않으며, 기존 hungry DB와 볼륨을 사용하지 않습니다.
각 테스트가 UUID 기반 임시 스키마를 만들고 자신이 만든 스키마만 삭제합니다.
마이그레이션, 실제 SQL, FK, 삭제 결과, 업로드/분석/행동 카드/상담 저장을 검증합니다.
AI 응답과 PDF 생성은 이 e2e에서 고정 응답으로 대체합니다.
DB에 연결할 수 없으면 테스트를 생략하지 않고 실패합니다.

이미 테스트 DB가 실행 중이면 `npm run test:e2e`만 실행하면 됩니다.
별도 PostgreSQL을 사용할 때는 프로세스 환경변수 TEST_DATABASE_URL로 접속 주소를 지정할 수 있습니다.
이 경우 스키마 생성/삭제 권한이 필요하며, 테스트 전용 DB를 사용하세요.

테스트 컨테이너 종료 및 임시 DB 폐기:

```bash
docker compose --env-file test/postgres.env -f compose.test.yaml down
```

AI 키는 ConfigService로 읽습니다. Claude는 ANTHROPIC_API_KEY를 우선하고
기존 CLAUDE_AI_API_KEY도 지원합니다. ANALYSIS_MODEL은 안전 분석 모델,
CHAT_MODEL은 Claude 상담 모델, CHAT_LLM=gemini는 상담만 Gemini로 변경합니다.

새 안전 분석 결과의 appliedPrecedentIds와 precedents 사전 키는 외부 판례 일련번호입니다.
사건번호는 사전의 표시 문구에 남으며, 저장된 과거 분석 결과는 변경하지 않습니다.
