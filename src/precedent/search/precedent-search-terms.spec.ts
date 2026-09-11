import {
  buildPrecedentTsQuery,
  extractPrecedentSearchTerms,
} from './precedent-search-terms';

describe('precedent search terms', () => {
  it('긴 자연어 검색어에서 조사와 어미를 제거한 검색어를 만든다', () => {
    const terms = extractPrecedentSearchTerms(
      '단톡방에서 친구를 모욕한 경우 공연성과 증거 인정 기준',
    );

    expect(terms).toEqual(
      expect.arrayContaining([
        '단톡방',
        '단체채팅방',
        '친구',
        '모욕',
        '공연성',
        '증거',
        '인정',
      ]),
    );
    expect(terms).not.toContain('경우');
    expect(terms).not.toContain('기준');
  });

  it('추출한 단어를 OR 검색식으로 만든다', () => {
    expect(buildPrecedentTsQuery(['단톡방', '모욕', '공연성'])).toBe(
      '단톡방 | 모욕 | 공연성',
    );
  });
});
