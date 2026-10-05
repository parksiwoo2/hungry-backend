# Precedent module

```text
precedent/
├─ analysis/   AI 판례 분석, 쟁점 추출, 임베딩 생성, 분석 CLI
├─ entities/   TypeORM 엔티티 6개
├─ external/   국가법령정보센터 API 연동, 동기화, 수집 CLI
├─ search/     하이브리드 검색, 증거 매칭, 검색어 전처리
├─ storage/    판례 저장·조회, 엔티티 모델 조회
├─ precedent.controller.ts
├─ precedent.module.ts
└─ precedent.http
```

`PrecedentModule`은 HTTP 라우팅과 서브모듈 조합만 담당합니다.

- `PrecedentExternalModule`은 `PrecedentStorageModule`을 사용해 외부 판례를 저장합니다.
- `PrecedentSearchModule`은 `PrecedentAnalysisModule`의 OpenAI 임베딩 서비스를 사용합니다.
- `entities`는 여러 서브모듈에서 공유하는 영속성 모델입니다.
- API 요청 예시는 `precedent.http`에서 관리합니다.
