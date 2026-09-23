import { keepGroundedTextIssues } from './precedent-analysis-grounding';
import type {
  PrecedentAnalysisIssue,
  PrecedentCourtFinding,
} from './precedent-analysis.types';

const courtFinding: PrecedentCourtFinding = {
  courtName: '법원',
  courtLevel: 'first_instance',
  holding: '판단',
  evidenceAssessment: '증거 판단',
  abstractRules: [],
  isGuiltyRecognized: true,
  evidenceAccepted: true,
  publicityRecognized: true,
  specificityRecognized: true,
};

function createIssue(evidenceTexts: string[]): PrecedentAnalysisIssue {
  return {
    evidenceType: 'group_chat_message',
    evidenceTexts,
    factPattern: '단체 대화방에 게시하였다.',
    searchSummary: '단체 대화방 발언에 관한 사건이다.',
    legalContext: {
      isGroupChat: true,
      audienceCount: 8,
      victimIdentifiable: true,
    },
    crimeTypes: ['모욕'],
    keywords: ['단체 대화방'],
    courtFindings: [courtFinding],
  };
}

describe('precedent analysis grounding', () => {
  it('이유 원문에 실제 존재하는 증거 텍스트만 남긴다', () => {
    const result = keepGroundedTextIssues(
      {
        issues: [
          createIssue(['너는 사기꾼이다', '모델이 만든 요약 문구']),
          createIssue(['원문에 없는 발언']),
        ],
      },
      '피고인은 단체 대화방에 “너는 사기꾼이다”라는 글을 게시하였다.',
    );

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].evidenceTexts).toEqual(['너는 사기꾼이다']);
  });
});
