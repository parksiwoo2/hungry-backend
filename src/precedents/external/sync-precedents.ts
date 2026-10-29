import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PrecedentSyncService } from './precedent-sync.service';

async function bootstrap() {
  const application = await NestFactory.createApplicationContext(AppModule);

  try {
    const syncService = application.get(PrecedentSyncService);
    const summary = process.argv.includes('--details-only')
      ? await syncService.syncMissingDetails()
      : await syncService.syncAll();
    Logger.log(JSON.stringify(summary, null, 2), 'PrecedentSync');
  } finally {
    await application.close();
  }
}

void bootstrap();
