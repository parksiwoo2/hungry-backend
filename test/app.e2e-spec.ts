import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('SafeguardController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('GET / — UI 페이지를 서빙한다', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/)
      .expect((res) => {
        if (!res.text.includes('대화')) throw new Error('UI 본문이 아님');
      });
  });

  it('POST /api/analyze — 잘못된 context는 400', () => {
    return request(app.getHttpServer())
      .post('/api/analyze')
      .send({ rawText: 'x', context: 'invalid', victimName: 'x' })
      .expect(400);
  });

  it('POST /api/analyze — 파싱 불가 원문은 400', () => {
    return request(app.getHttpServer())
      .post('/api/analyze')
      .send({
        rawText: '아무 형식도 아닌 텍스트',
        context: 'dm',
        victimName: 'x',
      })
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
