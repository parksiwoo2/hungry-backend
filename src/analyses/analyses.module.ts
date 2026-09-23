import { Module } from '@nestjs/common';
import { AnalysesService } from './analyses.service';

@Module({
  providers: [AnalysesService],
  exports: [AnalysesService], // ActionsModule 등 다른 모듈에서 사용할 수 있도록 export
})
export class AnalysesModule {}
