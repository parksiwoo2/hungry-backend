import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PrecedentAnalysisService } from './precedent-analysis.service';

async function bootstrap() {
  const application = await NestFactory.createApplicationContext(AppModule);

  try {
    const analysisService = application.get(PrecedentAnalysisService);
    const summary = await analysisService.analyzeAll({
      limit: readNumberArgument('--limit'),
      concurrency: readNumberArgument('--concurrency'),
      retryErrors: process.argv.includes('--retry-errors'),
    });
    Logger.log(JSON.stringify(summary, null, 2), 'PrecedentAnalysis');
  } finally {
    await application.close();
  }
}

function readNumberArgument(name: string): number | undefined {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));

  if (!argument) {
    return undefined;
  }

  const value = Number(argument.slice(prefix.length));

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name}은 1 이상의 정수여야 합니다.`);
  }

  return value;
}

void bootstrap();
