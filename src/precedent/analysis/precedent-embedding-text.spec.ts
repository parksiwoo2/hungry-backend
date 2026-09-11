import {
  buildFactEmbeddingText,
  buildRuleEmbeddingText,
  buildSummaryEmbeddingText,
  buildTargetEmbeddingText,
} from './precedent-embedding-text';

describe('precedent embedding text', () => {
  it('쟁점의 실제 증거 텍스트와 작성 맥락만 임베딩 텍스트로 만든다', () => {
    const issue = {
      evidenceType: 'group_chat_message',
      evidenceTexts: ['첫 번째 문제 발언', '두 번째 문제 발언'],
      factPattern: '8인 단체 대화방에서 피해자를 모욕하였다.',
      searchSummary: '단체 대화방 문제 발언에 관한 모욕 사건이다.',
      legalContext: {
        isGroupChat: true,
        audienceCount: 8,
        victimIdentifiable: true,
      },
      crimeTypes: ['임베딩에 포함되면 안 되는 죄명'],
      keywords: ['단체채팅방'],
      courtFindings: [
        {
          courtName: '서울중앙지방법원',
          courtLevel: 'first_instance',
          holding: '공연성을 인정하였다.',
          evidenceAssessment: '대화 내용을 증거로 인정하였다.',
          abstractRules: ['전파 가능성이 있으면 공연성이 인정될 수 있다.'],
          isGuiltyRecognized: true,
          evidenceAccepted: true,
          publicityRecognized: true,
          specificityRecognized: true,
        },
      ],
    } as const;
    const text = buildFactEmbeddingText(issue);

    expect(text).toContain(
      '증거 텍스트: 첫 번째 문제 발언 | 두 번째 문제 발언',
    );
    expect(text).toContain('참여 또는 수신 인원: 8');
    expect(text).not.toContain('공연성을 인정하였다.');
    expect(text).not.toContain('대화 내용을 증거로 인정하였다.');
    expect(text).not.toContain('임베딩에 포함되면 안 되는 죄명');
  });

  it('통합 요약과 법리를 서로 다른 임베딩 텍스트로 만든다', () => {
    const issue = {
      evidenceType: 'social_post',
      evidenceTexts: ['허위 게시물'],
      factPattern: '온라인 게시판에 글을 게시하였다.',
      searchSummary:
        '온라인 허위 게시물의 명예훼손 성립 여부를 판단한 사건이다.',
      legalContext: {
        isGroupChat: false,
        audienceCount: null,
        victimIdentifiable: true,
      },
      crimeTypes: ['명예훼손'],
      keywords: ['온라인 게시판', '허위사실'],
      courtFindings: [
        {
          courtName: '대법원',
          courtLevel: 'supreme',
          holding: '전파 가능성을 인정하였다.',
          evidenceAssessment: '게시물을 증거로 인정하였다.',
          abstractRules: ['불특정 다수가 인식할 수 있으면 공연성이 인정된다.'],
          isGuiltyRecognized: true,
          evidenceAccepted: true,
          publicityRecognized: true,
          specificityRecognized: true,
        },
      ],
    } as const;

    expect(buildSummaryEmbeddingText(issue)).toBe(issue.searchSummary);
    expect(buildRuleEmbeddingText(issue)).toContain('일반화된 법리');
    expect(buildRuleEmbeddingText(issue)).toContain('공연성이 인정된다');
    expect(buildRuleEmbeddingText(issue)).not.toContain('허위 게시물');
  });

  it('검색 입력의 발언과 법적 맥락을 임베딩 텍스트로 만든다', () => {
    const text = buildTargetEmbeddingText({
      targetText: '야 너 게이지 맞지?',
      legalContext: {
        isGroupChat: true,
        audienceCount: 8,
        victimIdentifiable: true,
      },
    });

    expect(text).toContain('증거 텍스트: 야 너 게이지 맞지?');
    expect(text).toContain('단체 대화방: 예');
    expect(text).toContain('피해자 식별 가능: 예');
  });
});
