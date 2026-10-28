import { anonymizeInput, deanonymize } from './anonymizer';

describe('deanonymize — AI 출력의 가명을 실명으로 되돌린다', () => {
  const map = { 학생A: '지우', 학생B: '하준', 학생K: '민규', 학생N: '세은' };

  it('학생K 형태는 그대로 실명이 된다', () => {
    expect(deanonymize('학생K가 학생A를 조롱', map)).toBe('민규가 지우를 조롱');
  });

  it('AI가 "학생"을 떼고 글자만 쓴 가명도 되돌린다 — 구분자·조사·괄호 사이의 홀로 선 글자', () => {
    expect(deanonymize('지우·K·B가 차례로 추궁', map)).toBe(
      '지우·민규·하준가 차례로 추궁',
    );
    expect(deanonymize('세은·B·K·A 4명이 비하', map)).toBe(
      '세은·하준·민규·지우 4명이 비하',
    );
    expect(deanonymize('K는 동조했고 (N)도 가담', map)).toBe(
      '민규는 동조했고 (세은)도 가담',
    );
    expect(deanonymize('B, K, N이 연달아', map)).toBe(
      '하준, 민규, 세은이 연달아',
    );
  });

  it('매핑에 없는 글자와 영단어 속 글자는 건드리지 않는다', () => {
    expect(deanonymize('AI로 합성하겠다고 함', map)).toBe(
      'AI로 합성하겠다고 함',
    );
    expect(deanonymize('C가 말함', map)).toBe('C가 말함'); // 학생C 없음
    expect(deanonymize('계좌 1002-B-K 송금', map)).toBe('계좌 1002-B-K 송금');
  });

  it('anonymizeInput 의 매핑으로 왕복하면 원래 이름이 돌아온다', () => {
    const { input, map: m } = anonymizeInput({
      messages: [
        { no: 1, time: '2026-10-01 10:00', sender: '지우', text: '하준 봐라' },
        { no: 2, time: '2026-10-01 10:01', sender: '하준', text: 'ㅇㅇ' },
      ],
      context: 'small_group',
      participantCount: 3,
      victimName: '서아',
      victimInRoom: true,
    });
    expect(input.messages[0].text).toBe('학생B 봐라');
    expect(deanonymize('학생A·B가 학생C를', m)).toBe('지우·하준가 서아를');
  });
});
