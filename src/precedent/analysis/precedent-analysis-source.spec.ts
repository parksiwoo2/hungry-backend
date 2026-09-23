import {
  buildPrecedentAnalysisChunk,
  buildPrecedentAnalysisSource,
} from './precedent-analysis-source';
import { PrecedentEntity } from '../entities/precedent.entity';

describe('precedent analysis source', () => {
  it('판례 튜플의 필드와 정규화된 전체 본문을 AI 입력으로 만든다', () => {
    const precedent = Object.assign(new PrecedentEntity(), {
      externalId: '1',
      caseNumber: '2026도1',
      caseName: '모욕',
      courtName: '대법원',
      courtTypeCode: '400201',
      judgementDate: '20260817',
      sentenceType: '선고',
      caseType: '형사',
      caseTypeCode: '400102',
      judgementType: '판결',
      dataSource: '국가법령정보센터',
      summary: null,
      gist: '판결요지',
      refLaws: '형법',
      refCases: null,
      fullContent: '기존 본문',
      matchedCategories: ['모욕'],
      matchedQueries: ['온라인 모욕'],
      rawDetailHtml: null,
      detailStatus: 'json',
      detailError: null,
      detailFetchedAt: null,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    });
    const source = buildPrecedentAnalysisSource(precedent, '정규화된 본문');
    const chunk = buildPrecedentAnalysisChunk(source, '본문 조각', 0, 2);

    expect(source.summary).toBeNull();
    expect(source.fullContent).toBe('정규화된 본문');
    expect(chunk).toMatchObject({
      externalId: '1',
      gist: '판결요지',
      fullContent: '본문 조각',
      fullContentChunk: { index: 1, total: 2 },
    });
  });
});
