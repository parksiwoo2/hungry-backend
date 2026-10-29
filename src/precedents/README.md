# Precedents module

```text
precedents/
├─ analysis/   AI 판례 분석, 쟁점 추출, 임베딩 생성, 분석 CLI
├─ entities/   TypeORM 엔티티 6개
├─ external/   국가법령정보센터 API 연동, 동기화, 수집 CLI
├─ search/     하이브리드 검색, 증거 매칭, 검색어 전처리
├─ storage/    판례 저장·조회, 엔티티 모델 조회
├─ precedents.controller.ts
├─ precedents.module.ts
└─ precedent.http
```

`PrecedentsModule`은 HTTP 라우팅과 서브모듈 조합만 담당합니다.

- `PrecedentExternalModule`은 `PrecedentStorageModule`을 사용해 외부 판례를 저장합니다.
- `PrecedentSearchModule`은 `PrecedentAnalysisModule`의 OpenAI 임베딩 서비스를 사용합니다.
- `entities`는 여러 서브모듈에서 공유하는 영속성 모델입니다.
- API 요청 예시는 `precedent.http`에서 관리합니다.

## HTTP 응답

- 모든 판례 경로는 `/precedents`로 시작합니다. 이전 `/precedent` 경로는 제공하지 않습니다.
- `POST /precedents/search`: `{ query, results }`를 반환합니다. 응답의 `mode`, `filters`, 각 결과의 `score`는 제거했으며 내부 점수 계산과 정렬은 유지합니다. 검색 요청 옵션은 기존과 같습니다.
- `GET /precedents/:precedentId`: 저장된 `{ precedent, issues }`를 반환합니다. `precedent.externalId`가 판례 ID이며 각 쟁점에 `courtFindings`를 포함합니다. 쟁점은 `issueOrder`, 법원 판단은 `findingOrder` 오름차순입니다.
- 상세 조회는 외부 API를 호출하지 않습니다. 저장된 판례가 없으면 404, 숫자가 아닌 ID는 400, 쟁점이 없으면 `issues: []`입니다. 로그인은 기존과 같이 필요합니다.
