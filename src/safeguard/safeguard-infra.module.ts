/**
 * Safe Guard 가 바깥에 기대는 것 두 가지를 한곳에 모은다 — 저장소와 판례 매칭.
 *
 * SafeguardModule 은 SAFEGUARD_STORE · PRECEDENT_PROVIDER 토큰만 알고 구현은 모른다.
 * 운영 구현을 바꿀 땐 이 파일만 고치고, e2e 는 이 모듈을 테스트용 모듈로 통째로 갈아 끼운다
 * (test/app.e2e-spec.ts 의 overrideModule).
 */
import { Module } from '@nestjs/common';
import * as path from 'path';
import {
  NoopPrecedentProvider,
  PRECEDENT_PROVIDER,
} from './precedent-provider';
import { SAFEGUARD_STORE } from './storage/safeguard-store';
import { SqliteSafeguardStore } from './storage/sqlite-safeguard-store';

@Module({
  providers: [
    {
      provide: SAFEGUARD_STORE,
      useFactory: () =>
        new SqliteSafeguardStore(
          process.env.SAFEGUARD_DB ??
            path.join(process.cwd(), 'data', 'safeguard.sqlite'),
        ),
    },
    { provide: PRECEDENT_PROVIDER, useClass: NoopPrecedentProvider },
  ],
  exports: [SAFEGUARD_STORE, PRECEDENT_PROVIDER],
})
export class SafeguardInfraModule {}
