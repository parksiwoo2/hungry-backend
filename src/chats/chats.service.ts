import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../prisma/prisma.service';
import { AnalysesService } from '../analyses/analyses.service';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const EMERGENCY_CONTACTS = [
  { name: '자살예방 상담전화', tel: '1393' },
  { name: '청소년 위기전화', tel: '1388' },
  { name: '경찰청 학교/사이버폭력 신고', tel: '117' },
];

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly db: DatabaseService,
    private readonly analysesService: AnalysesService,
  ) {
    this.genAI = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY || 'dummy_key',
    );
  }

  // -----------------------------------------------------------------------
  // 시스템 프롬프트 생성 헬퍼
  // -----------------------------------------------------------------------
  private buildSystemInstruction(
    analysis: Awaited<ReturnType<AnalysesService['get']>>,
  ): string {
    const attackerNames = Object.keys(analysis.summary.attackerCounts).join(', ');
    const harmTypes = analysis.utterances.flatMap((u) => u.harmTypes);
    const uniqueHarmTypes = [...new Set(harmTypes)].join(', ') || '미상';
    const severity = analysis.utterances[0]?.severity ?? '알 수 없음';

    return `너는 학교폭력/사이버폭력 피해 청소년을 위로하고 지지해주는 전문 심리 상담사 '안심이'야.
아래는 내담자(사용자)가 겪은 사이버폭력 2차 분석 결과야. 이 상황을 이미 알고 있다는 전제 하에 대화를 이끌어줘.

[내담자 및 피해 정보]
- 이름: ${analysis.victimName}
- 폭력 패턴: ${analysis.patterns.join(', ')}
- 피해 심각도: ${severity}
- 가해자: ${attackerNames || '불상'}
- 피해 지속 기간: ${analysis.summary.distinctDays}일 (반복 여부: ${analysis.summary.isRepeated ? '반복됨' : '단발성'})
- 피해 유형: ${uniqueHarmTypes}

[상담 가이드라인]
1. 내담자의 감정에 깊이 공감하고, 절대 내담자의 탓을 하지 마.
2. 해결책을 강요하기보다 내담자의 이야기를 들어주는 데 집중해.
3. 중고등학생이 편안하게 느낄 수 있는 친근하면서도 정중한 존댓말(예: ~했어요, ~요)을 사용해.
4. [중요] 내담자가 자해, 자살, 극단적 선택 등을 암시하는 말을 하면 isCrisis를 true로 반환해.`;
  }

  // -----------------------------------------------------------------------
  // 공통 Gemini 모델 생성 헬퍼
  // -----------------------------------------------------------------------
  private buildModel(systemInstruction: string) {
    return this.genAI.getGenerativeModel({
      model: 'gemini-3.5-flash',
      systemInstruction,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            reply: { type: SchemaType.STRING },
            isCrisis: { type: SchemaType.BOOLEAN },
          },
          required: ['reply', 'isCrisis'],
        },
      },
    });
  }

  // -----------------------------------------------------------------------
  // POST /api/chats/intro
  // -----------------------------------------------------------------------
  async intro(analysisId: string) {
    const analysis = await this.analysesService.get(analysisId);

    // 세션 생성
    const session = this.db.createSession(analysisId);

    const systemInstruction = this.buildSystemInstruction(analysis);
    const model = this.buildModel(systemInstruction);

    const prompt = `내담자 '${analysis.victimName}'님과의 상담을 시작할 초기 인사말을 작성해줘. 분석 결과를 바탕으로 구체적인 공감을 담아서 작성하고, 마지막은 열린 질문으로 끝내줘.`;

    try {
      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text()) as {
        reply: string;
        isCrisis: boolean;
      };

      this.db.createMessage(session.id, 'model', parsed.reply);

      return { sessionId: session.id, greeting: parsed.reply };
    } catch (e) {
      this.logger.error('Gemini intro 생성 실패', e);
      const fallback = `안녕하세요 ${analysis.victimName}님, 안심이입니다. 오늘 어떤 이야기를 나눠볼까요?`;
      this.db.createMessage(session.id, 'model', fallback);
      return { sessionId: session.id, greeting: fallback };
    }
  }

  // -----------------------------------------------------------------------
  // POST /api/chats/messages
  // -----------------------------------------------------------------------
  async sendMessage(sessionId: string, userMessage: string) {
    const session = this.db.findSession(sessionId);

    if (!session) throw new NotFoundException('Session not found');
    if (session.status === 'CRISIS_CLOSED') {
      throw new Error('이 세션은 위기 상황으로 종료되었습니다.');
    }

    // 사용자 메시지 저장
    this.db.createMessage(sessionId, 'user', userMessage);

    const analysis = await this.analysesService.get(session.analysisId);
    const systemInstruction = this.buildSystemInstruction(analysis);
    const model = this.buildModel(systemInstruction);

    // Gemini chat history는 반드시 'user' 턴으로 시작해야 함.
    // DB에서 가져온 메시지 중 첫 user 메시지 이전의 model 인사말은 제외.
    // 현재 전송할 userMessage는 방금 저장된 마지막 항목이므로 history에서 제외.
    const allMessages = this.db.findMessagesBySession(sessionId);
    const firstUserIdx = allMessages.findIndex((m) => m.role === 'user');
    const historyMessages = firstUserIdx >= 0
      ? allMessages.slice(firstUserIdx, -1)
      : [];

    const history = historyMessages.map((m) => ({
      role: m.role as 'user' | 'model',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });

    try {
      const result = await chat.sendMessage(userMessage);
      const parsed = JSON.parse(result.response.text()) as {
        reply: string;
        isCrisis: boolean;
      };

      this.db.createMessage(sessionId, 'model', parsed.reply);

      if (parsed.isCrisis) {
        this.db.updateSessionStatus(sessionId, 'CRISIS_CLOSED');
        return {
          reply: parsed.reply,
          isCrisis: true,
          emergencyContacts: EMERGENCY_CONTACTS,
        };
      }

      return { reply: parsed.reply, isCrisis: false, emergencyContacts: null };
    } catch (e) {
      this.logger.error('Gemini 응답 생성 실패', e);
      const fallback = '지금 일시적으로 연결이 어렵습니다. 잠시 후 다시 시도해 주세요. 긴급한 상황이라면 117 또는 1388로 연락해 주세요.';
      this.db.createMessage(sessionId, 'model', fallback);
      return { reply: fallback, isCrisis: false, emergencyContacts: null };
    }
  }
}
