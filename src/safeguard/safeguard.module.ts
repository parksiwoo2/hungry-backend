import { Module } from '@nestjs/common';
import { SafeguardController } from './safeguard.controller';
import { SafeguardAnalysisService } from './safeguard-analysis.service';
import { ReportPdfService } from './report-pdf.service';

@Module({
  controllers: [SafeguardController],
  providers: [SafeguardAnalysisService, ReportPdfService],
})
export class SafeguardModule {}
