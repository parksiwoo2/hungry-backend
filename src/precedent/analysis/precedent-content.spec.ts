import {
  preparePrecedentContent,
  splitPrecedentContent,
} from './precedent-content';

describe('precedent content', () => {
  it('이유 제목과 관계없이 판례 전체를 정규화한다', () => {
    expect(preparePrecedentContent('주문\r\n【이 유】 같은 줄 이유')).toEqual({
      status: 'found',
      content: '주문\n【이 유】 같은 줄 이유',
    });
  });

  it('외부 API 오류 본문은 분석 대상에서 제외한다', () => {
    expect(
      preparePrecedentContent('OPEN API 로그인 후 이용할 수 있습니다.'),
    ).toEqual({ status: 'invalid_content', content: null });
  });

  it('긴 판례는 겹치는 조각으로 나누고 전체 위치를 포함한다', () => {
    const content = `${'가'.repeat(90)}\n${'나'.repeat(90)}\n${'다'.repeat(90)}`;
    const chunks = splitPrecedentContent(content, 120, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('가'.repeat(50)))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('다'.repeat(50)))).toBe(true);
  });
});
