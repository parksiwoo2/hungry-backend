import { ChatGeminiLlmService } from './chat-llm.gemini.temp';

const OK_BODY = {
  candidates: [
    {
      content: {
        parts: [
          { text: JSON.stringify({ reply: '괜찮아요', isCrisis: false }) },
        ],
      },
    },
  ],
};

function mockFetch(body: unknown, init: { status?: number } = {}) {
  return jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: init.status ?? 200,
    }),
  );
}

describe('ChatGeminiLlmService [임시]', () => {
  const service = new ChatGeminiLlmService();
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...saved };
  });

  it('키는 헤더로, 역할은 user/model 로 바꿔 보내고 응답을 파싱한다', async () => {
    const fetchSpy = mockFetch(OK_BODY);

    const out = await service.reply('시스템', [
      { role: 'user', content: '시작' },
      { role: 'assistant', content: '안녕하세요' },
      { role: 'user', content: '불안해요' },
    ]);

    expect(out).toEqual({ reply: '괜찮아요', isCrisis: false });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/gemini-3.5-flash:generateContent');
    expect(url).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'test-key',
    );
    const body = JSON.parse(init.body as string) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { role: string }[];
    };
    expect(body.systemInstruction.parts[0].text).toBe('시스템');
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('GEMINI_MODEL 로 모델을 바꾼다', async () => {
    process.env.GEMINI_MODEL = 'gemini-x';
    const fetchSpy = mockFetch(OK_BODY);

    await service.reply('s', [{ role: 'user', content: 'a' }]);

    expect(fetchSpy.mock.calls[0][0]).toContain('/models/gemini-x:');
  });

  it('키가 없으면 호출 없이 던진다', async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchSpy = mockFetch(OK_BODY);

    await expect(
      service.reply('s', [{ role: 'user', content: 'a' }]),
    ).rejects.toThrow('GEMINI_API_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('HTTP 오류는 상태 코드를 담아 던지고 키는 노출하지 않는다', async () => {
    mockFetch('{"error":{"message":"API key not valid"}}', { status: 400 });

    const err = await service
      .reply('s', [{ role: 'user', content: 'a' }])
      .catch((e: unknown) => e as Error);

    expect(err.message).toContain('400');
    expect(err.message).not.toContain('test-key');
  });

  it('프롬프트 차단·빈 응답·스키마 위반은 던진다', async () => {
    const msgs = [{ role: 'user' as const, content: 'a' }];

    mockFetch({ promptFeedback: { blockReason: 'SAFETY' } });
    await expect(service.reply('s', msgs)).rejects.toThrow('SAFETY');

    jest.restoreAllMocks();
    mockFetch({ candidates: [] });
    await expect(service.reply('s', msgs)).rejects.toThrow('빈 응답');

    jest.restoreAllMocks();
    mockFetch({
      candidates: [{ content: { parts: [{ text: '{"reply":"x"}' }] } }],
    });
    await expect(service.reply('s', msgs)).rejects.toThrow();
  });
});
