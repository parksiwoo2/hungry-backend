import { Module } from '@nestjs/common';
import { ActionsModule } from './actions/actions.module';
import { AnalysesModule } from './analyses/analyses.module';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ChatsModule } from './chats/chats.module';

@Module({
  imports: [
    ActionsModule,
    AnalysesModule,
    PrismaModule,
    ChatsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
