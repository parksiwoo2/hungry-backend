import { Module } from '@nestjs/common';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { SafeguardModule } from '../safeguard/safeguard.module';

@Module({
  imports: [SafeguardModule],
  controllers: [ActionsController],
  providers: [ActionsService],
})
export class ActionsModule {}
