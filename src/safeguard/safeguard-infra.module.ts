/**
 * Safe Guard 가 바깥에 기대는 것 두 가지를 한곳에 모은다 — 저장소와 판례 매칭.
 *
 * SafeguardModule 은 SAFEGUARD_STORE · PRECEDENT_PROVIDER 토큰만 알고 구현은 모른다.
 * 운영 구현을 바꿀 땐 이 파일만 고치고, e2e 는 이 모듈을 테스트용 모듈로 통째로 갈아 끼운다
 * (test/app.e2e-spec.ts 의 overrideModule).
 *
 *   저장소     팀 Postgres (AppModule 의 TypeORM DataSource). 스키마는 마이그레이션이 만든다.
 *   판례 매칭  팀 판례 검색 모듈(pgvector + 임베딩)을 우리 계약으로 감싼 어댑터.
 */
import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PrecedentSearchModule } from '../precedent/search/precedent-search.module';
import { PrecedentStorageModule } from '../precedent/storage/precedent-storage.module';
import { PRECEDENT_PROVIDER } from './precedent-provider';
import { SAFEGUARD_STORE } from './storage/safeguard-store';
import { PostgresSafeguardStore } from './storage/postgres-safeguard-store';
import { VectorPrecedentProvider } from './vector-precedent-provider';

@Module({
  imports: [PrecedentSearchModule, PrecedentStorageModule],
  providers: [
    {
      provide: SAFEGUARD_STORE,
      inject: [DataSource],
      useFactory: (db: DataSource) => new PostgresSafeguardStore(db),
    },
    { provide: PRECEDENT_PROVIDER, useClass: VectorPrecedentProvider },
  ],
  exports: [SAFEGUARD_STORE, PRECEDENT_PROVIDER],
})
export class SafeguardInfraModule {}
