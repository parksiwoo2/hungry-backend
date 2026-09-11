import { mergePrecedentAnalyses } from './precedent-analysis-merge';
import type { PrecedentAnalysisIssue } from './precedent-analysis.types';

function createIssue(holding: string): PrecedentAnalysisIssue {
  return {
    evidenceType: 'social_post',
    evidenceTexts: ['동일한 게시물'],
    factPattern: '게시물을 작성하였다.',
    searchSummary: '게시물 관련 판례이다.',
    legalContext: {
      isGroupChat: false,
      audienceCount: null,
      victimIdentifiable: true,
    },
    crimeTypes: ['명예훼손'],
    keywords: ['게시물'],
    courtFindings: [
      {
        courtName: '대법원',
        courtLevel: 'supreme',
        holding,
        evidenceAssessment: '',
        abstractRules: [],
        isGuiltyRecognized: null,
        evidenceAccepted: null,
        publicityRecognized: true,
        specificityRecognized: true,
      },
    ],
  };
}

describe('precedent analysis merge', () => {
  it('겹치는 원문 조각에서 나온 동일 쟁점과 법원 판단을 합친다', () => {
    const result = mergePrecedentAnalyses([
      { issues: [createIssue('공연성을 인정했다.')] },
      {
        issues: [
          createIssue(
            '불특정 다수에게 전파될 가능성이 있어 공연성을 인정했다.',
          ),
        ],
      },
    ]);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].courtFindings).toHaveLength(1);
    expect(result.issues[0].courtFindings[0].holding).toContain('불특정 다수');
  });
});
