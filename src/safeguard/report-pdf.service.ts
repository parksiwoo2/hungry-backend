/**
 * 정리문서 PDF 생성 (#4)
 *
 * 왜 Puppeteer인가:
 *   - 표·인용·계층 구조가 필요한데 HTML/CSS가 가장 다루기 쉽다
 *   - pandoc/LibreOffice는 서버에 외부 바이너리를 요구해 배포가 복잡해진다
 *   - 한글 렌더링이 시스템 폰트로 자연히 해결된다
 *
 * 주의:
 *   - 브라우저 인스턴스는 재사용한다. 요청마다 launch 하면 수 초씩 든다.
 *   - Docker 배포 시 Chromium 의존성 필요 (puppeteer 이미지 사용 권장)
 *
 * deps: npm i puppeteer
 */
import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import type { Browser } from 'puppeteer';
import type {
  ChatMessage,
  FlaggedItem,
  AnalyzeInput,
} from './safeguard-analysis.service';
import {
  LawRegistry,
  HARM_LAW_MAP,
  DM_FALLBACK,
  REMOVAL_TRACK,
  CIVIL_TRACK,
} from './law-registry';

export interface ReportInput {
  input: AnalyzeInput;
  result: { flagged: FlaggedItem[]; patterns: string[] };
  summary: {
    count: number;
    start?: string;
    end?: string;
    typeCounts: Record<string, number>;
    attackerCounts: Record<string, number>;
    urgentCount: number;
    distinctDays: number;
    isRepeated: boolean;
  };
  /** true면 관련 조항·절차를 함께 싣고, false면 판단 근거만 싣는다 */
  legal: boolean;
}

@Injectable()
export class ReportPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(ReportPdfService.name);
  private readonly laws = new LawRegistry();
  private browser?: Browser;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.connected) {
      // 지연 로드 — puppeteer(ESM)를 부팅·테스트 시점에 끌어오지 않는다
      const { default: puppeteer } = await import('puppeteer');
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return this.browser;
  }

  async onModuleDestroy() {
    await this.browser?.close();
  }

  async generate(r: ReportInput): Promise<Buffer> {
    const html = this.buildHtml(r);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate: `
            <div style="width:100%;font-size:8pt;color:#888;padding:0 16mm;
                        display:flex;justify-content:space-between;font-family:sans-serif">
              <span>본 문서는 참고용이며 법률 자문이 아닙니다</span>
              <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
            </div>`,
        }),
      );
    } finally {
      await page.close();
    }
  }

  // ─── HTML 조립 ───

  private esc(s: string): string {
    return String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
    );
  }

  private buildHtml(r: ReportInput): string {
    const { input, result, summary, legal } = r;
    const isDm = input.context === 'dm';

    const typeSummary = Object.entries(summary.typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}회`)
      .join(' · ');
    const attackers = Object.entries(summary.attackerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}회`)
      .join(' · ');

    const items = result.flagged
      .map((f) => this.renderItem(f, input.messages, isDm, legal))
      .join('\n');

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
    font-size: 10.5pt; line-height: 1.65; color: #1a1a1a; margin: 0;
    word-break: keep-all;
  }
  h1 { font-size: 17pt; margin: 0 0 4mm; letter-spacing: -0.02em; }
  h2 { font-size: 12.5pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm;
       border-bottom: 1.5px solid #1a1a1a; }
  h3 { font-size: 10.5pt; margin: 0 0 2mm; font-weight: 600; }

  .meta { color: #555; font-size: 9pt; line-height: 1.5;
          border-bottom: 1px solid #ddd; padding-bottom: 4mm; margin-bottom: 2mm; }

  .overview { background: #f6f7f9; border-radius: 3px; padding: 4mm 5mm; margin-bottom: 2mm; }
  .overview .lead { font-size: 11pt; font-weight: 600; margin-bottom: 2.5mm; }
  .overview dl { display: grid; grid-template-columns: 22mm 1fr;
                 gap: 1.2mm 3mm; margin: 0; font-size: 9.5pt; }
  .overview dt { color: #666; }
  .overview dd { margin: 0; }
  .flag { color: #b00020; font-weight: 600; }

  /* 피해 항목 — 페이지 중간에서 잘리지 않게 */
  .item { border-left: 2.5px solid #ccc; padding: 0 0 0 4mm; margin: 0 0 5mm;
          break-inside: avoid; page-break-inside: avoid; }
  .item.urgent { border-left-color: #b00020; }
  .item .head { display: flex; justify-content: space-between; align-items: baseline;
                gap: 3mm; margin-bottom: 1.5mm; }
  .item .when { font-size: 9pt; color: #666; font-variant-numeric: tabular-nums; }
  .sev { font-size: 8pt; padding: 0.6mm 2mm; border-radius: 2px; white-space: nowrap; }
  .sev.즉시조치 { background: #b00020; color: #fff; }
  .sev.주의 { background: #e8a33d; color: #fff; }
  .sev.관찰 { background: #e5e5e5; color: #444; }

  blockquote { margin: 0 0 2mm; padding: 2mm 3mm; background: #fafafa;
               border: 1px solid #eee; border-radius: 2px; font-size: 10pt; }
  .tags { font-size: 9pt; color: #444; margin-bottom: 1.5mm; }
  .law { font-size: 9pt; margin-top: 1.5mm; padding-top: 1.5mm; border-top: 1px dotted #ddd; }
  .law .art { font-weight: 600; }
  .law .sub { color: #555; padding-left: 3mm; display: block; margin-top: 0.6mm; }
  .reason { font-size: 9pt; color: #555; }

  .track { margin-bottom: 4mm; break-inside: avoid; }
  .track h3 { color: #1a1a1a; }
  .track p { margin: 0 0 1.5mm; font-size: 9.5pt; }
  .track .name { font-weight: 600; }

  .disclaimer { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #ddd;
                font-size: 8.5pt; color: #666; line-height: 1.6; }
</style></head><body>

<h1>사이버폭력 피해 정리</h1>
<div class="meta">
  분석 대상: ${this.esc(this.contextLabel(input.context))} (참여 ${input.participantCount}명)
  &nbsp;·&nbsp; 피해자: ${this.esc(input.victimName)}<br>
  법령 기준일: ${this.laws.collectedAt.slice(0, 10)} (국가법령정보 현행 조문)
</div>

<h2>1. 피해 개요</h2>
<div class="overview">
  <div class="lead">${summary.start} ~ ${summary.end} 기간 동안 총 ${summary.count}회의 피해가 확인되었습니다.</div>
  <dl>
    <dt>유형별</dt><dd>${this.esc(typeSummary)}</dd>
    <dt>발신자별</dt><dd>${this.esc(attackers)}</dd>
    <dt>즉시 조치</dt><dd${summary.urgentCount > 0 ? ' class="flag"' : ''}>${summary.urgentCount}건</dd>
    <dt>발생 기간</dt><dd>서로 다른 ${summary.distinctDays}일${summary.isRepeated ? ' <span class="flag">(반복성 인정 범위)</span>' : ''}</dd>
    ${result.patterns.length ? `<dt>관찰된 패턴</dt><dd class="flag">${this.esc(result.patterns.join(' · '))}</dd>` : ''}
  </dl>
</div>

<h2>2. 피해 내역</h2>
${items}

${legal ? this.renderTracks(isDm) : ''}

<div class="disclaimer">
  본 정리는 참고용이며 법률 자문이 아닙니다.
  정확한 판단은 변호사·대한법률구조공단(132)·청소년 상담 1388에 문의하세요.<br>
  조문 원문과 형량은 국가법령정보 Open API에서 수집한 현행 조문을 기준으로 자동 생성되었습니다.
</div>

</body></html>`;
  }

  private contextLabel(c: string): string {
    return (
      (
        {
          dm: '1:1 개인 대화',
          small_group: '소수 단체 대화방',
          large_group: '다수 단체 대화방',
          public: '공개 게시판·SNS',
        } as Record<string, string>
      )[c] ?? c
    );
  }

  private renderItem(
    f: FlaggedItem,
    messages: ChatMessage[],
    isDm: boolean,
    legal: boolean,
  ): string {
    const s = messages[f.no - 1];
    const laws = legal ? this.renderLaws(f.harmTypes, isDm) : '';
    const reason = !legal
      ? `<div class="reason">${this.esc(f.reason)}</div>`
      : '';

    return `<div class="item ${f.severity === '즉시조치' ? 'urgent' : ''}">
  <div class="head">
    <span class="when">${this.esc(s.time)} · ${this.esc(s.sender)}</span>
    <span class="sev ${f.severity}">${f.severity}</span>
  </div>
  <blockquote>${this.esc(s.text)}</blockquote>
  <div class="tags">${this.esc((f.harmTypes as string[]).join(', '))}</div>
  ${reason}${laws}
</div>`;
  }

  /** 유형 → 조문. 형량은 원문에서 추출하므로 개정되면 자동 반영 */
  private renderLaws(harmTypes: string[], isDm: boolean): string {
    const seenArt = new Set<string>();
    const seenNote = new Set<string>();
    const rows: string[] = [];

    for (const t of harmTypes) {
      let meta = HARM_LAW_MAP[t];
      if (!meta) continue;
      if (meta.needsPublicity && isDm) meta = DM_FALLBACK;

      for (const key of meta.articleKeys) {
        const a = this.laws.article(key);
        if (!a || seenArt.has(a.라벨)) continue;
        seenArt.add(a.라벨);
        rows.push(`<div class="art">${this.esc(this.laws.summarize(a))}</div>`);
      }
      const n = this.laws.prosecutionNotice(meta.prosecution);
      if (!seenNote.has(n)) {
        seenNote.add(n);
        rows.push(`<span class="sub">${this.esc(n)}</span>`);
      }
      if (meta.note && !seenNote.has(meta.note)) {
        seenNote.add(meta.note);
        rows.push(`<span class="sub">${this.esc(meta.note)}</span>`);
      }
    }
    return rows.length ? `<div class="law">${rows.join('')}</div>` : '';
  }

  private renderTracks(isDm: boolean): string {
    const fast = this.laws.article(REMOVAL_TRACK.fast.articleKey);
    const official = this.laws.article(REMOVAL_TRACK.official.articleKey);
    const civil = CIVIL_TRACK.map((k) => this.laws.article(k)?.라벨)
      .filter(Boolean)
      .join(' · ');

    const dmNote = isDm
      ? `<p>1:1 개인 대화는 공연성(불특정·다수가 인식할 수 있는 상태)이 인정되지 않아
         모욕죄·명예훼손죄가 성립하기 어렵습니다. 대신 반복 전송·협박·스토킹 조항으로 검토하였습니다.</p>`
      : '';

    return `<h2>3. 병행 가능한 절차</h2>
<div class="track">
  <h3>게시물 삭제·차단 — 처벌 절차와 동시에 진행할 수 있습니다</h3>
  <p><span class="name">빠른 경로 · ${this.esc(fast?.라벨 ?? '정통망법 제44조의2')}</span><br>${this.esc(REMOVAL_TRACK.fast.how)}</p>
  <p><span class="name">공적 경로 · ${this.esc(official?.라벨 ?? '정통망법 제44조의7')}</span><br>${this.esc(REMOVAL_TRACK.official.how)}</p>
</div>
<div class="track">
  <h3>학교폭력 절차</h3>
  <p>심의위원회는 학교의 요청이 있는 경우 21일 이내에 개최됩니다(7일 이내 연장 가능).</p>
  <p>조치 결과에 불복하는 경우 통지일로부터 90일 이내에 행정심판 또는 행정소송을 제기할 수 있습니다.</p>
</div>
<div class="track">
  <h3>민사</h3>
  <p>형사 처벌 여부와 별개로 손해배상을 청구할 수 있습니다 (${this.esc(civil)}).</p>
  <p>가해자가 미성년자인 경우 민법 제755조에 따라 보호자에게 청구할 수 있습니다.
     소멸시효는 피해를 안 날부터 3년입니다.</p>
  ${dmNote}
</div>`;
  }
}
