import { NotFoundException } from '@nestjs/common';
import type {
  PrecedentMatch,
  PrecedentMatchRequest,
} from '../precedent/analysis/precedent-analysis.types';
import type { PrecedentMatchService } from '../precedent/search/precedent-match.service';
import type {
  PrecedentStoreService,
  StoredPrecedentDetail,
} from '../precedent/storage/precedent-store.service';
import type { AnalysisTarget } from './precedent-provider';
import { VectorPrecedentProvider } from './vector-precedent-provider';

const target = (id: string, text = `구간 ${id}`): AnalysisTarget => ({
  targetMessageId: id,
  targetText: text,
  legalContext: {
    isGroupChat: true,
    audienceCount: 5,
    victimIdentifiable: true,
  },
});

const hit = (precedentId: string, caseNumber: string | null): PrecedentMatch =>
  ({
    precedentId,
    caseNumber,
    courtName: '대법원',
    searchSummary: 'AI가 쓴 검색용 요약 — 2차 판단에 들어가면 안 된다',
    factPattern: 'AI가 쓴 사실관계',
  }) as PrecedentMatch;

const stored = (over: Partial<StoredPrecedentDetail>): StoredPrecedentDetail =>
  ({
    courtName: '대법원',
    summary: null,
    gist: null,
    ...over,
  }) as StoredPrecedentDetail;

/** 팀원 모듈 두 개의 가짜 — 요청을 기록하고 정해 둔 결과를 돌려준다 */
function fakes(
  matchesFor: (targetText: string) => PrecedentMatch[],
  details: Record<string, StoredPrecedentDetail>,
) {
  const requests: PrecedentMatchRequest[] = [];
  const matcher = {
    findMatches: (body: unknown) => {
      const req = body as PrecedentMatchRequest;
      requests.push(req);
      return Promise.resolve({
        retrievalOnly: true as const,
        analysisTargets: req.analysisTargets.map((t) => ({
          ...t,
          matches: matchesFor(t.targetText),
        })),
      });
    },
  } as unknown as PrecedentMatchService;
  const store = {
    findOne: (id: string) =>
      details[id]
        ? Promise.resolve(details[id])
        : Promise.reject(
            new NotFoundException('저장된 판례를 찾을 수 없습니다.'),
          ),
  } as unknown as PrecedentStoreService;
  return { provider: new VectorPrecedentProvider(matcher, store), requests };
}

describe('VectorPrecedentProvider — 팀 판례 검색을 우리 계약으로 변환', () => {
  it('사건번호만 뽑아 붙이고, 사전의 요지는 AI 요약이 아니라 판시사항 원문에서 만든다', async () => {
    const { provider } = fakes(
      () => [hit('100', '2003도709'), hit('200', '2006도546')],
      {
        '100': stored({
          summary:
            '[1] 공갈죄의 수단으로서 협박의   의미\n[2] 다른 쟁점은 사전에 넣지 않는다',
        }),
        '200': stored({ summary: null, gist: '판결요지 원문' }),
      },
    );

    const out = await provider.match({ analysisTargets: [target('32,34')] });

    expect(out.analysisTargets).toEqual([
      { ...target('32,34'), matchedPrecedentIds: ['2003도709', '2006도546'] },
    ]);
    expect(out.precedentDict).toEqual({
      '2003도709': '대법원 2003도709: 공갈죄의 수단으로서 협박의 의미',
      '2006도546': '대법원 2006도546: 판결요지 원문',
    });
  });

  it('사건번호가 없거나 원문 요지를 못 구한 판례는 뺀다', async () => {
    const { provider } = fakes(
      () => [
        hit('1', null), //            사건번호 없음 — 우리 ID 체계에 못 넣는다
        hit('2', '2020도1'), //       판시사항·판결요지 둘 다 비어 있음
        hit('3', '2020도2'), //       저장소에 없음
        hit('4', '2020도5813'),
      ],
      {
        '2': stored({ summary: '  ', gist: null }),
        '4': stored({ summary: '전파가능성 법리' }),
      },
    );

    const out = await provider.match({ analysisTargets: [target('1')] });

    expect(out.analysisTargets[0].matchedPrecedentIds).toEqual(['2020도5813']);
    expect(Object.keys(out.precedentDict)).toEqual(['2020도5813']);
  });

  it('구간이 10개를 넘으면 나눠 호출하고 입력 순서를 지킨다', async () => {
    const targets = Array.from({ length: 23 }, (_, i) => target(String(i + 1)));
    const { provider, requests } = fakes(
      (text) => [hit(text, `2000도${text.replace('구간 ', '')}`)],
      Object.fromEntries(
        targets.map((t) => [t.targetText, stored({ summary: '요지' })]),
      ),
    );

    const out = await provider.match({ analysisTargets: targets });

    expect(requests.map((r) => r.analysisTargets.length)).toEqual([10, 10, 3]);
    expect(out.analysisTargets.map((t) => t.targetMessageId)).toEqual(
      targets.map((t) => t.targetMessageId),
    );
    expect(out.analysisTargets[22].matchedPrecedentIds).toEqual(['2000도23']);
  });

  it('검색 모듈의 입력 제한에 맞춘다 — 5000자 초과는 자르고 targetMessageId 는 보내지 않는다', async () => {
    const { provider, requests } = fakes(() => [], {});

    await provider.match({
      analysisTargets: [target('7', '가'.repeat(6000))],
    });

    const sent = requests[0].analysisTargets[0];
    expect(sent.targetText).toHaveLength(5000);
    expect(sent).not.toHaveProperty('targetMessageId');
  });

  it('검색이 실패해도 분석을 멈추지 않는다 — 판례 없이 진행하도록 빈 결과를 준다', async () => {
    const matcher = {
      findMatches: () =>
        Promise.reject(
          new Error('SECRET_KEY 환경 변수가 설정되지 않았습니다.'),
        ),
    } as unknown as PrecedentMatchService;
    const provider = new VectorPrecedentProvider(
      matcher,
      {} as PrecedentStoreService,
    );

    const out = await provider.match({ analysisTargets: [target('1')] });

    expect(out).toEqual({
      precedentDict: {},
      analysisTargets: [{ ...target('1'), matchedPrecedentIds: [] }],
    });
  });
});
