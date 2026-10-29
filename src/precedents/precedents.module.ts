import { Module } from '@nestjs/common';
import { PrecedentAnalysisModule } from './analysis/precedent-analysis.module';
import { PrecedentExternalModule } from './external/precedent-external.module';
import { PrecedentsController } from './precedents.controller';
import { PrecedentSearchModule } from './search/precedent-search.module';
import { PrecedentStorageModule } from './storage/precedent-storage.module';

@Module({
  imports: [
    PrecedentStorageModule,
    PrecedentExternalModule,
    PrecedentAnalysisModule,
    PrecedentSearchModule,
  ],
  controllers: [PrecedentsController],
  exports: [PrecedentExternalModule, PrecedentAnalysisModule],
})
export class PrecedentsModule {}
