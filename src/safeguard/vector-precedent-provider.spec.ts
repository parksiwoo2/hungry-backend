import { NotFoundException } from '@nestjs/common';
import type {
  PrecedentMatch,
  PrecedentMatchRequest,
} from '../precedents/analysis/precedent-analysis.types';
import type { PrecedentMatchService } from '../precedents/search/precedent-match.service';
import type {
  PrecedentStoreService,
  StoredPrecedentDetail,
} from '../precedents/storage/precedent-store.service';
import type { DataSource } from 'typeorm';
import type { AnalysisTarget } from './precedent-provider';
import {
  VectorPrecedentProvider,
  type IssueRow,
} from './vector-precedent-provider';

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
  issueRows: IssueRow[] = [],
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
  const db = {
    query: (_sql: string, [ids]: [string[]]) =>
      Promise.resolve(issueRows.filter((r) => ids.includes(r.precedent_id))),
  } as unknown as DataSource;
  return {
    provider: new VectorPrecedentProvider(matcher, store, db),
    requests,
  };
}

describe('VectorPrecedentProvider — 팀 판례 검색을 우리 계약으로 변환', () => {
  it('일련번호를 ID로 유지하고 사건번호와 판시사항은 표시 문구에 넣는다', async () => {
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
      { ...target('32,34'), matchedPrecedentIds: ['100', '200'] },
    ]);
    expect(out.precedentDict).toEqual({
      '100': '대법원 2003도709: 공갈죄의 수단으로서 협박의 의미',
      '200': '대법원 2006도546: 판결요지 원문',
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

    expect(out.analysisTargets[0].matchedPrecedentIds).toEqual(['4']);
    expect(Object.keys(out.precedentDict)).toEqual(['4']);
  });

  it('구간이 10개를 넘으면 나눠 호출하고 입력 순서를 지킨다', async () => {
    const targets = Array.from({ length: 23 }, (_, i) => target(String(i + 1)));
    const { provider, requests } = fakes(
      (text) => [
        hit(text.replace('구간 ', ''), `2000도${text.replace('구간 ', '')}`),
      ],
      Object.fromEntries(
        targets.map((t) => [t.targetMessageId, stored({ summary: '요지' })]),
      ),
    );

    const out = await provider.match({ analysisTargets: targets });

    expect(requests.map((r) => r.analysisTargets.length)).toEqual([10, 10, 3]);
    expect(out.analysisTargets.map((t) => t.targetMessageId)).toEqual(
      targets.map((t) => t.targetMessageId),
    );
    expect(out.analysisTargets[22].matchedPrecedentIds).toEqual(['23']);
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
          new Error('SECRET_KEY_SEARCH 환경 변수가 설정되지 않았습니다.'),
        ),
    } as unknown as PrecedentMatchService;
    const provider = new VectorPrecedentProvider(
      matcher,
      {} as PrecedentStoreService,
      { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource,
    );

    const out = await provider.match({ analysisTargets: [target('1')] });

    expect(out).toEqual({
      precedentDict: {},
      analysisTargets: [{ ...target('1'), matchedPrecedentIds: [] }],
    });
  });

  describe('describe — 정리 문서에 실을 판례 상세', () => {
    it('SQL 조회 실패는 빈 결과로 처리하고 저장소를 호출하지 않는다', async () => {
      const query = jest.fn().mockRejectedValue(new Error('SQL 장애'));
      const findOne = jest.fn();
      const provider = new VectorPrecedentProvider(
        {} as PrecedentMatchService,
        { findOne } as unknown as PrecedentStoreService,
        { query } as unknown as DataSource,
      );
      await expect(provider.describe(['227693'])).resolves.toEqual([]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(findOne).not.toHaveBeenCalled();
    });
    const row = (over: Partial<IssueRow>): IssueRow => ({
      precedent_id: '227693',
      issue_order: 1,
      evidence_texts: ['너희들도 조심해라.'],
      finding_order: 1,
      court_name: '대구지방법원 (원심)',
      is_guilty_recognized: true,
      ...over,
    });

    it('원문 필드와 심급별 결론·법원이 다룬 발언을 모아 돌려준다', async () => {
      const { provider } = fakes(
        () => [],
        {
          '227693': stored({
            id: '227693',
            caseNumber: '2022도4171',
            caseName: '정보통신망이용촉진및정보보호등에관한법률위반(명예훼손)',
            judgementDate: '20220728',
            summary: '[1] 비방할 목적의 의미\n[2] 다른 쟁점',
            refLaws: '[1] 정보통신망법 제70조 제1항',
          }),
        },
        [
          row({}),
          row({
            finding_order: 2,
            court_name: '대법원',
            is_guilty_recognized: false,
          }),
          // 두 번째 쟁점의 발언과 결론은 첫 번째 쟁점과 분리한다
          row({
            issue_order: 2,
            evidence_texts: ['두 번째 발언', '너희들도 조심해라.'],
            finding_order: 1,
            court_name: '대법원',
            is_guilty_recognized: null,
          }),
        ],
      );

      const out = await provider.describe(['227693']);

      expect(out).toEqual([
        {
          id: '227693',
          caseNumber: '2022도4171',
          court: '대법원',
          caseName: '정보통신망이용촉진및정보보호등에관한법률위반(명예훼손)',
          decidedOn: '2022-07-28',
          summary: '비방할 목적의 의미',
          refLaws: '[1] 정보통신망법 제70조 제1항',
          issues: [
            {
              issueOrder: 1,
              quotedTexts: ['너희들도 조심해라.'],
              rulings: [
                { court: '대구지방법원 (원심)', guilty: true },
                { court: '대법원', guilty: false },
              ],
            },
            {
              issueOrder: 2,
              quotedTexts: ['두 번째 발언', '너희들도 조심해라.'],
              rulings: [{ court: '대법원', guilty: null }],
            },
          ],
        },
      ]);
    });

    it('사건번호가 없거나 저장소에 없는 판례는 빼고, 입력 순서를 지킨다', async () => {
      const { provider } = fakes(() => [], {
        '1': stored({ id: '1', caseNumber: null, summary: '요지' }),
        '3': stored({ id: '3', caseNumber: '2020도3', summary: '요지 3' }),
        '4': stored({ id: '4', caseNumber: '2020도4', summary: '요지 4' }),
      });

      const out = await provider.describe(['4', '1', '2', '3']);

      expect(out.map((d) => d.id)).toEqual(['4', '3']);
      expect(out[0]).toMatchObject({ issues: [] });
    });

    it('조회가 실패하면 빈 목록 — 문서 생성이 판례 때문에 막히지 않는다', async () => {
      const findOne = jest.fn().mockRejectedValue(new Error('저장소 장애'));
      const query = jest.fn().mockResolvedValue([]);
      const provider = new VectorPrecedentProvider(
        {} as PrecedentMatchService,
        { findOne } as unknown as PrecedentStoreService,
        { query } as unknown as DataSource,
      );
      await expect(provider.describe(['227693'])).resolves.toEqual([]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(findOne).toHaveBeenCalledWith('227693');
    });
  });
});
