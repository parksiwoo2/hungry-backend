import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import * as path from 'path';
import { AppModule } from './app.module';
import { buildValidationPipe } from './validation-pipe';

async function bootstrap() {
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
    `Safe Guard 백엔드 — http://localhost:${process.env.PORT ?? 3000}`,
  );
}

void bootstrap();
