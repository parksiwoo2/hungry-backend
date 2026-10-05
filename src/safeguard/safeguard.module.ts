import { Module } from '@nestjs/common';
import { SafeguardController } from './safeguard.controller';
import { SessionsController } from './sessions.controller';
import { AnalysesController } from './analyses.controller';
import { SafeguardAnalysisService } from './safeguard-analysis.service';
import { ReportPdfService } from './report-pdf.service';
import { SessionsService } from './sessions.service';
import { AnalysesService } from './analyses.service';
import { SafeguardInfraModule } from './safeguard-infra.module';

@Module({
  // 저장소·판례 매칭 구현은 인프라 모듈이 정한다 — 여기는 토큰으로만 주입받는다
  imports: [SafeguardInfraModule],
  controllers: [SafeguardController, SessionsController, AnalysesController],
  providers: [
    SafeguardAnalysisService,
    ReportPdfService,
    SessionsService,
    AnalysesService,
  ],
  // 다른 모듈(행동 제시 카드 등)이 분석 결과를 읽는 창구
  exports: [AnalysesService],
})
export class SafeguardModule {}
