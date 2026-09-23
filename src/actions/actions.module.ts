import { Module } from '@nestjs/common';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { AnalysesModule } from '../analyses/analyses.module';

@Module({
  imports: [AnalysesModule],
  controllers: [ActionsController],
  providers: [ActionsService],
})
export class ActionsModule {}
