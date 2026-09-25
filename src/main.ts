import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { join } from 'path';
import * as fs from 'fs';

async function bootstrap() {
  try {
    const envPath = join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf8');
      envFile.split('\n').forEach((line) => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
          process.env[key.trim()] = values.join('=').trim().replace(/['"]/g, '');
        }
      });
      console.log('✅ .env 파일 로드 완료');
    }
  } catch (e) {
    console.log('⚠️ .env 파일 로드 실패', e.message);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // CORS 허용 (브라우저에서 직접 호출 가능하도록)
  app.enableCors();

  // 루트 디렉토리의 정적 파일 서빙 (test_client.html 포함)
  app.useStaticAssets(join(__dirname, '..', '..'), {
    prefix: '/static/',
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(`\n🚀 서버 실행 중: http://localhost:${process.env.PORT ?? 3000}`);
  console.log(`🧪 테스트 클라이언트: http://localhost:${process.env.PORT ?? 3000}/static/test_client.html\n`);
}
bootstrap();
