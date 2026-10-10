import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { buildValidationPipe } from './validation-pipe';

/**
 * CLAUDE_AI_API_KEY를 Anthropic SDK가 읽는 ANTHROPIC_API_KEY로 옮긴다.
 * ConfigModule도 .env를 읽지만 이 이름 변환은 하지 않으므로 부팅 전에 직접 처리한다.
 * (키가 없으면 분석 요청 시점에 실패한다)
 */
function loadEnv() {
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (k && v && !process.env[k]) process.env[k] = v;
  }
  if (process.env.CLAUDE_AI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.CLAUDE_AI_API_KEY;
  }
}

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const httpLogger = new Logger('HTTP');

  // 대화 원문이 body로 오므로 기본 100kb 제한을 올린다
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalPipes(buildValidationPipe());

  app.useStaticAssets(path.join(process.cwd(), 'public'));

  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();

    response.on('finish', () => {
      httpLogger.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`,
      );
    });

    next();
  });
  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `Safe Guard 백엔드 — http://localhost:${process.env.PORT ?? 3000}`);
  }
  
void bootstrap();
