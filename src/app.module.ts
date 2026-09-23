import { Module } from '@nestjs/common';
import { ActionsModule } from './actions/actions.module';
import { AnalysesModule } from './analyses/analyses.module';
import { AppController } from './app.controller';

@Module({
  imports: [ActionsModule, AnalysesModule],
  controllers: [AppController],
})
export class AppModule {}
