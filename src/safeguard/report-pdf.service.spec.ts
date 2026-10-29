/**
 * 정리 문서 HTML 조립 — Puppeteer 없이 HTML 문자열만 검사한다.
 * 문서는 한 종류다: 사실(인용·집계) + AI 판단 근거 + 관련 조문 + 참고 판례 + 절차.
 */
import type { ReportInput } from './report-pdf.service';
import { ReportPdfService } from './report-pdf.service';
import type { PrecedentDetail } from './precedent-provider';

const messages = [
  { no: 1, time: '2026-10-03 14:22', sender: '학생A', text: '야 돼지 꺼져' },
  { no: 2, time: '2026-10-03 14:23', sender: '학생B', text: 'ㅋㅋ 맞음' },
  {
    no: 3,
    time: '2026-10-04 09:10',
    sender: '학생A',
    text: '돈 안 주면 알지?',
  },
];

const precedent: PrecedentDetail = {
  id: '227693',
  caseNumber: '2022도4171',
  court: '대법원',
  caseName: '정보통신망이용촉진및정보보호등에관한법률위반(명예훼손)',
  decidedOn: '2022-07-28',
  summary: '비방할 목적의 의미',
  refLaws: '정보통신망법 제70조 제1항',
  quotedTexts: ['너희들도 조심해라.'],
  rulings: [
    { court: '대구지방법원 (원심)', guilty: true },
    { court: '대법원', guilty: false },
  ],
};

function report(over: Partial<ReportInput> = {}): ReportInput {
  const flagged = [
    {
      messageNos: [1, 2],
      harmTypes: ['모욕' as const],
      severity: '주의' as const,
      reason: 'AI가 쓴 근거 문장',
      appliedPrecedentIds: ['227693'],
    },
    {
      messageNos: [3],
      harmTypes: ['갈취강요' as const],
      severity: '즉시조치' as const,
      reason: '금품 요구',
      appliedPrecedentIds: [],
    },
  ];
  return {
    input: {
      messages,
      context: 'large_group',
      participantCount: 10,
      victimName: '유진',
      victimInRoom: true,
    },
    result: { flagged, patterns: [] },
    summary: {
      count: 2,
      start: '2026-10-03',
      end: '2026-10-04',
      typeCounts: { 모욕: 1, 갈취강요: 1 },
      attackerCounts: { 학생A: 2, 학생B: 1 },
      urgentCount: 1,
      distinctDays: 2,
      isRepeated: false,
    },
    precedents: [],
    ...over,
  };
}

describe('ReportPdfService.buildHtml — 문서 한 종류에 근거·조문·판례를 같이 싣는다', () => {
  const svc = new ReportPdfService();

  it('피해 항목마다 AI 판단 근거와 관련 조문이 함께 나온다', () => {
    const html = svc.buildHtml(report());

    expect(html).toContain('AI가 쓴 근거 문장');
    expect(html).toContain('형법 제311조');
    expect(html).toContain('AI 판단 근거');
  });

  it('참고 판례가 있으면 3절에 사건·결론·법원이 다룬 발언·관련 구간을 싣고 절차는 4절이 된다', () => {
    const html = svc.buildHtml(report({ precedents: [precedent] }));

    expect(html).toContain('<h2>3. 참고 판례</h2>');
    expect(html).toContain('<h2>4. 병행 가능한 절차</h2>');
    expect(html).toContain('대법원 2022. 7. 28. 선고 2022도4171 판결');
    expect(html).toContain('대구지방법원 (원심) 유죄 → 대법원 무죄');
    expect(html).toContain('너희들도 조심해라.');
    expect(html).toContain('정보통신망법 제70조 제1항');
    // 이 판례를 참고한 구간 — 첫 구간(10-03 14:22 ~ 14:23)만
    expect(html).toMatch(/관련 구간[\s\S]*10-03 14:22/);
    expect(html).toContain('그대로 적용된다는 뜻은 아닙니다');
  });

  it('참고 판례가 없으면 그 절을 만들지 않고 절차가 3절이다', () => {
    const html = svc.buildHtml(report());

    expect(html).not.toContain('참고 판례');
    expect(html).toContain('<h2>3. 병행 가능한 절차</h2>');
  });

  it('결론 플래그가 없는 심급은 "판단 없음"으로 적는다', () => {
    const html = svc.buildHtml(
      report({
        precedents: [
          { ...precedent, rulings: [{ court: '서울고등법원', guilty: null }] },
        ],
      }),
    );

    expect(html).toContain('서울고등법원 판단 없음');
  });
});
