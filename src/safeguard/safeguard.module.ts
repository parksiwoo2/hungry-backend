import { Module } from '@nestjs/common';
import * as path from 'path';
import { SafeguardController } from './safeguard.controller';
import { SessionsController } from './sessions.controller';
import { AnalysesController } from './analyses.controller';
import { SafeguardAnalysisService } from './safeguard-analysis.service';
import { ReportPdfService } from './report-pdf.service';
import { SessionsService } from './sessions.service';
import { AnalysesService } from './analyses.service';
import { SAFEGUARD_STORE } from './storage/safeguard-store';
import { SqliteSafeguardStore } from './storage/sqlite-safeguard-store';

@Module({
  controllers: [SafeguardController, SessionsController, AnalysesController],
  providers: [
    SafeguardAnalysisService,
    ReportPdfService,
    SessionsService,
    AnalysesService,
    {
      // 팀 DB가 정해지면 이 프로바이더만 다른 SafeguardStore 구현으로 바꾼다
      provide: SAFEGUARD_STORE,
      useFactory: () =>
        new SqliteSafeguardStore(
          process.env.SAFEGUARD_DB ??
            path.join(process.cwd(), 'data', 'safeguard.sqlite'),
        ),
    },
  ],
})
export class SafeguardModule {}
