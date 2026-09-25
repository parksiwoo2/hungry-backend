import { Module } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { AnalysesModule } from '../analyses/analyses.module';

@Module({
  imports: [AnalysesModule],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}
