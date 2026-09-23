import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrecedentStorageModule } from '../storage/precedent-storage.module';
import { PrecedentSyncService } from './precedent-sync.service';
import { PrecedentService } from './precedent.service';

@Module({
  imports: [HttpModule.register({ timeout: 15000 }), PrecedentStorageModule],
  providers: [PrecedentService, PrecedentSyncService],
  exports: [PrecedentService, PrecedentSyncService],
})
export class PrecedentExternalModule {}
