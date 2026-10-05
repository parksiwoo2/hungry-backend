import type { PrecedentAnalysisSource } from './precedent-analysis-source';
import type { PrecedentAnalysisIssue } from './precedent-analysis.types';
import {
  buildPrecedentSearchText,
  collectIssueCrimeTypes,
  collectIssueKeywords,
} from './precedent-search-text';

describe('precedent search text', () => {
  it('판례 튜플과 AI 쟁점 정보를 키워드 검색 문서로 합친다', () => {
    const source = {
      externalId: '1',
      caseNumber: '2007노120',
      caseName: '명예훼손',
      courtName: '법원',
      judgementDate: '20070101',
      caseType: '형사',
      judgementType: '판결',
      summary: '판시사항',
      gist: '판결요지',
      refLaws: '형법 제307조',
      refCases: null,
      fullContent: '싸이월드에 글을 게시하였다.',
      matchedCategories: ['명예훼손'],
      matchedQueries: ['싸이월드 명예훼손'],
    } as PrecedentAnalysisSource;
    const issue = {
      searchSummary: '허위 게시물에 관한 판례이다.',
      factPattern: '게시물을 작성하였다.',
      evidenceTexts: ['문제 게시물'],
      crimeTypes: ['명예훼손'],
      keywords: ['싸이월드', '공연성'],
      courtFindings: [
        {
          courtName: '법원',
          holding: '공연성을 인정하였다.',
          evidenceAssessment: '게시물을 증거로 인정하였다.',
          abstractRules: ['전파 가능성이 있으면 공연성이 인정된다.'],
        },
      ],
    } as PrecedentAnalysisIssue;

    const text = buildPrecedentSearchText(source, [issue]);

    expect(text).toContain('2007노120');
    expect(text).toContain('형법 제307조');
    expect(text).toContain('싸이월드');
    expect(collectIssueCrimeTypes([issue])).toEqual(['명예훼손']);
    expect(collectIssueKeywords([issue])).toEqual(['싸이월드', '공연성']);
  });
});
