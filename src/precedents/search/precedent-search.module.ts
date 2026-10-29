import { Module } from '@nestjs/common';
import { PrecedentAnalysisModule } from '../analysis/precedent-analysis.module';
import { PrecedentHybridSearchService } from './precedent-hybrid-search.service';
import { PrecedentMatchService } from './precedent-match.service';

@Module({
  imports: [PrecedentAnalysisModule],
  providers: [PrecedentHybridSearchService, PrecedentMatchService],
  exports: [PrecedentHybridSearchService, PrecedentMatchService],
})
export class PrecedentSearchModule {}
