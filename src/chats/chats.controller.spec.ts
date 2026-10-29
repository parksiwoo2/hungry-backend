/**
 * 컨트롤러 계층 — 라우트·검증·상태 코드만 본다. 서비스는 스텁으로 갈아 끼운다
 * (저장소·LLM 흐름은 chats.service.spec.ts).
 */
import type { Request, Response, NextFunction } from 'express';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { buildValidationPipe } from '../validation-pipe';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

describe('ChatsController', () => {
  let app: INestApplication<App>;
  const service = {
    intro: jest.fn(),
    sendMessage: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatsController],
      providers: [{ provide: ChatsService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(buildValidationPipe());
    app.use(
      (
        req: Request & { userId?: string },
        _res: Response,
        next: NextFunction,
      ) => {
        req.userId = 'test-user';
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.intro.mockReset();
    service.sendMessage.mockReset();
  });

  it('POST /chats/intro — 200 과 인사말', async () => {
    service.intro.mockResolvedValue({
      sessionId: SESSION_ID,
      greeting: '안녕',
    });

    await request(app.getHttpServer())
      .post('/chats/intro')
      .send({ analysisId: 'ana_1' })
      .expect(200)
      .expect({ sessionId: SESSION_ID, greeting: '안녕' });
    expect(service.intro).toHaveBeenCalledWith('ana_1', 'test-user');
  });

  it('POST /chats/intro — analysisId 가 없으면 400', async () => {
    await request(app.getHttpServer())
      .post('/chats/intro')
      .send({})
      .expect(400);
    expect(service.intro).not.toHaveBeenCalled();
  });

  it('POST /chats/messages — 200, 메시지는 앞뒤 공백을 자른다', async () => {
    service.sendMessage.mockResolvedValue({
      reply: '네',
      isCrisis: false,
      emergencyContacts: null,
    });

    await request(app.getHttpServer())
      .post('/chats/messages')
      .send({ sessionId: SESSION_ID, userMessage: '  불안해요  ' })
      .expect(200);
    expect(service.sendMessage).toHaveBeenCalledWith(
      SESSION_ID,
      '불안해요',
      'test-user',
    );
  });

  it.each([
    ['uuid 형식이 아닌 sessionId', { sessionId: 'abc', userMessage: '안녕' }],
    ['공백뿐인 메시지', { sessionId: SESSION_ID, userMessage: '   ' }],
    [
      '너무 긴 메시지',
      { sessionId: SESSION_ID, userMessage: 'ㅇ'.repeat(2001) },
    ],
    [
      '정의되지 않은 필드',
      { sessionId: SESSION_ID, userMessage: '안녕', chatHistory: [] },
    ],
  ])('POST /chats/messages — %s 은 400', async (_name, body) => {
    await request(app.getHttpServer())
      .post('/chats/messages')
      .send(body)
      .expect(400);
    expect(service.sendMessage).not.toHaveBeenCalled();
  });
});
