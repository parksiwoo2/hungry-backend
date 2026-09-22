import { Module } from '@nestjs/common';
import { SafeguardModule } from './safeguard/safeguard.module';

@Module({
  imports: [SafeguardModule],
})
export class AppModule {}
