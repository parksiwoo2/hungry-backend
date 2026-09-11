import { Module } from '@nestjs/common';
import { PrecedentAnalysisModule } from './analysis/precedent-analysis.module';
import { PrecedentExternalModule } from './external/precedent-external.module';
import { PrecedentController } from './precedent.controller';
import { PrecedentSearchModule } from './search/precedent-search.module';
import { PrecedentStorageModule } from './storage/precedent-storage.module';

@Module({
  imports: [
    PrecedentStorageModule,
    PrecedentExternalModule,
    PrecedentAnalysisModule,
    PrecedentSearchModule,
  ],
  controllers: [PrecedentController],
  exports: [PrecedentExternalModule, PrecedentAnalysisModule],
})
export class PrecedentModule {}
