import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { AnalysesService } from '../safeguard/analyses.service';
import type { AnalysisResponse } from '../safeguard/analyses.service';
import type { ChatLlmService, ChatReply } from './chat-llm.service';
import {
  CRISIS_FALLBACK_REPLY,
  EMERGENCY_CONTACTS,
  FALLBACK_REPLY,
  type LlmMessage,
} from './chat-prompt';
import { ChatsService } from './chats.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession, ChatSessionStatus } from './entities/chat-session.entity';

const ANALYSIS = {
  analysisId: 'ana_1',
  status: 'done',
  context: 'large_group',
  victimName: '윤아',
  patterns: ['셔틀'],
  utterances: [],
  summary: {
    total: 1,
    urgentCount: 0,
    typeCounts: {},
    attackerCounts: { 민준: 2 },
    distinctDays: 3,
    isRepeated: true,
    period: null,
  },
} as unknown as AnalysisResponse;

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function setup(opts?: {
  session?: Partial<ChatSession> | null;
  history?: Partial<ChatMessage>[];
  analysis?: AnalysisResponse;
}) {
  const em = {
    create: jest.fn((_cls: unknown, v: object) => v),
    save: jest.fn((v: object) => Promise.resolve({ ...v, id: SESSION_ID })),
    insert: jest.fn(() => Promise.resolve()),
    update: jest.fn(() => Promise.resolve()),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof em) => Promise<unknown>) => cb(em)),
  };
  const session =
    opts?.session === null
      ? null
      : {
          id: SESSION_ID,
          analysisId: 'ana_1',
          status: ChatSessionStatus.ACTIVE,
          ...opts?.session,
        };
  const sessions = { findOneBy: jest.fn(() => Promise.resolve(session)) };
  // 서비스는 seq DESC 로 읽고 뒤집는다 — 저장소는 최신순으로 돌려준다
  const messages = {
    find: jest.fn(() => Promise.resolve([...(opts?.history ?? [])].reverse())),
  };
  const analyses = {
    get: jest.fn(() => Promise.resolve(opts?.analysis ?? ANALYSIS)),
  };
  const llm = { reply: jest.fn<Promise<ChatReply>, [string, LlmMessage[]]>() };
  const service = new ChatsService(
    sessions as never,
    messages as never,
    dataSource as never,
    analyses as unknown as AnalysesService,
    llm as unknown as ChatLlmService,
  );
  return { service, em, dataSource, sessions, messages, analyses, llm };
}

const HISTORY: Partial<ChatMessage>[] = [
  { seq: 1, role: 'assistant', content: '안녕하세요' },
  { seq: 2, role: 'user', content: '불안해요' },
  { seq: 3, role: 'assistant', content: '그랬군요' },
];

describe('ChatsService.intro', () => {
  it('세션과 인사말을 한 트랜잭션으로 저장하고 sessionId·greeting 을 돌려준다', async () => {
    const { service, em, llm } = setup();
    llm.reply.mockResolvedValue({ reply: '윤아님, 반가워요', isCrisis: false });

    const res = await service.intro('ana_1', 'test-user');

    expect(res).toEqual({
      sessionId: SESSION_ID,
      greeting: '윤아님, 반가워요',
    });
    expect(em.insert).toHaveBeenCalledWith(ChatMessage, {
      sessionId: SESSION_ID,
      seq: 1,
      role: 'assistant',
      content: '윤아님, 반가워요',
    });
  });

  it('LLM 이 실패하면 기본 인사말로 세션을 만든다', async () => {
    const { service, llm } = setup();
    llm.reply.mockRejectedValue(new Error('boom'));

    const res = await service.intro('ana_1', 'test-user');

    expect(res.sessionId).toBe(SESSION_ID);
    expect(res.greeting).toContain('윤아님');
  });

  it('분석이 끝나지 않았으면 409, LLM 은 부르지 않는다', async () => {
    const running = { ...ANALYSIS, status: 'running', summary: null };
    const { service, llm, dataSource } = setup({
      analysis: running as unknown as AnalysisResponse,
    });

    await expect(service.intro('ana_1', 'test-user')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(llm.reply).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('ChatsService.sendMessage', () => {
  it('없는 세션은 404', async () => {
    const { service } = setup({ session: null });
    await expect(
      service.sendMessage(SESSION_ID, '안녕', 'test-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('위기로 종료된 세션은 409 이고 긴급 연락처를 같이 준다', async () => {
    const { service, llm } = setup({
      session: { status: ChatSessionStatus.CRISIS_CLOSED },
    });

    const err = await service
      .sendMessage(SESSION_ID, '안녕', 'test-user')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      emergencyContacts: EMERGENCY_CONTACTS,
    });
    expect(llm.reply).not.toHaveBeenCalled();
  });

  it('일반 대화: 이력 뒤 순번으로 두 줄을 저장하고 연락처는 null', async () => {
    const { service, em, llm } = setup({ history: HISTORY });
    llm.reply.mockResolvedValue({ reply: '천천히 말해줘요', isCrisis: false });

    const res = await service.sendMessage(
      SESSION_ID,
      '내일이 걱정돼요',
      'test-user',
    );

    expect(res).toEqual({
      reply: '천천히 말해줘요',
      isCrisis: false,
      emergencyContacts: null,
      fallback: false,
    });
    expect(em.insert).toHaveBeenCalledWith(ChatMessage, [
      {
        sessionId: SESSION_ID,
        seq: 4,
        role: 'user',
        content: '내일이 걱정돼요',
      },
      {
        sessionId: SESSION_ID,
        seq: 5,
        role: 'assistant',
        content: '천천히 말해줘요',
      },
    ]);
    expect(em.update).not.toHaveBeenCalled();
  });

  it('LLM 에 보내는 메시지는 가상 user 턴 + 이력 + 새 메시지', async () => {
    const { service, llm } = setup({ history: HISTORY });
    llm.reply.mockResolvedValue({ reply: 'ok', isCrisis: false });

    await service.sendMessage(SESSION_ID, '내일이 걱정돼요', 'test-user');

    const sent = llm.reply.mock.calls[0][1];
    expect(sent.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('LLM 이 위기로 판정하면 세션을 닫고 연락처를 준다', async () => {
    const { service, em, llm } = setup({ history: HISTORY });
    llm.reply.mockResolvedValue({ reply: '곁에 있을게요', isCrisis: true });

    const res = await service.sendMessage(
      SESSION_ID,
      '너무 힘들어요',
      'test-user',
    );

    expect(res.isCrisis).toBe(true);
    expect(res.emergencyContacts).toEqual(EMERGENCY_CONTACTS);
    expect(em.update).toHaveBeenCalledWith(
      ChatSession,
      { id: SESSION_ID },
      { status: ChatSessionStatus.CRISIS_CLOSED },
    );
  });

  it('LLM 이 놓쳐도 키워드가 있으면 위기로 처리한다', async () => {
    const { service, em, llm } = setup({ history: HISTORY });
    llm.reply.mockResolvedValue({ reply: '그렇군요', isCrisis: false });

    const res = await service.sendMessage(
      SESSION_ID,
      '죽고 싶어요',
      'test-user',
    );

    expect(res.isCrisis).toBe(true);
    expect(em.update).toHaveBeenCalled();
  });

  it('LLM 이 실패해도 위기 키워드는 연락처를 준다 (고정 위기 문구로 저장·종료)', async () => {
    const { service, em, llm } = setup({ history: HISTORY });
    llm.reply.mockRejectedValue(new Error('boom'));

    const res = await service.sendMessage(
      SESSION_ID,
      '자해하고 싶어',
      'test-user',
    );

    expect(res).toEqual({
      reply: CRISIS_FALLBACK_REPLY,
      isCrisis: true,
      emergencyContacts: EMERGENCY_CONTACTS,
      fallback: false, // 저장·종료까지 끝난 최종 응답 — 재시도 대상이 아니다
    });
    expect(em.update).toHaveBeenCalled();
  });

  it('LLM 이 실패한 일반 메시지는 아무것도 저장하지 않는다', async () => {
    const { service, dataSource, llm } = setup({ history: HISTORY });
    llm.reply.mockRejectedValue(new Error('boom'));

    const res = await service.sendMessage(SESSION_ID, '안녕', 'test-user');

    expect(res).toEqual({
      reply: FALLBACK_REPLY,
      isCrisis: false,
      emergencyContacts: null,
      fallback: true, // 클라이언트가 같은 요청을 재시도한다
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('동시 전송으로 순번이 겹치면 409', async () => {
    const { service, em, llm } = setup({ history: HISTORY });
    llm.reply.mockResolvedValue({ reply: 'ok', isCrisis: false });
    em.insert.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      ),
    );

    await expect(
      service.sendMessage(SESSION_ID, '안녕', 'test-user'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
