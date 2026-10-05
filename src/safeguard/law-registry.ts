/**
 * 법령 레지스트리 — LAW_MAP과 API 수집 데이터(law-articles.json)를 잇는 계층
 *
 * 왜 필요한가:
 *   형량을 코드에 문자열로 박아두면 법이 개정될 때 앱이 틀린 정보를 준다.
 *   실제로 대조 결과 2건이 이미 어긋나 있었다:
 *     - 정통망법 70조② 5천만원 → 7천만원 (2026.1.6 개정)
 *     - 저작권법 136조① 5년/5천만원 → 7년/1억원 (2026.2.10 개정)
 *
 * 구조:
 *   유형 → 조문키 매핑(우리 자산, 판례 기반)  +  조문키 → 원문·시행일자(API 수집)
 *   앱은 JSON만 읽는다. API는 동기화 때만 호출한다.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ArticleRecord {
  법령명: string;
  조문번호: string;
  조문제목: string;
  본문: string;
  시행일자: string;
  라벨: string;
  항수: number;
}

interface ArticleFile {
  수집일시: string;
  출처: string;
  조문수: number;
  실패: string[];
  조문: Record<string, ArticleRecord>;
}

/** 소추요건 — 조문 원문에서 자동 판별할 수 없어 판례·해석으로 확정한 값 */
export type Prosecution = '친고죄' | '반의사불벌' | '없음';

/** 유형별 법적 성질 — 조문 원문이 아니라 판례·해석에서 나온 우리 자산 */
export interface HarmLawMeta {
  /** law-articles.json 의 조문 키 (복수 가능 — 상상적 경합) */
  articleKeys: string[];
  prosecution: Prosecution;
  /** 공연성이 필요한가 — 1:1 DM에서 성립 여부를 가른다 */
  needsPublicity: boolean;
  /** 판례에서 나온 주의사항 */
  note?: string;
}

/**
 * 유형 → 조문 매핑.
 * 조문 키는 law-articles.json 과 일치해야 한다.
 */
export const HARM_LAW_MAP: Record<string, HarmLawMeta> = {
  명예훼손: {
    articleKeys: ['명예훼손'],
    prosecution: '반의사불벌',
    needsPublicity: true,
    note: '구체적 사실 적시 + 사회적 평가 저하 필요. 공익 목적이면 비방목적 부인 가능(2018도15868)',
  },
  모욕: {
    articleKeys: ['모욕'],
    prosecution: '친고죄',
    needsPublicity: true,
    note: '고소기간 6개월(범인을 안 날부터). 무례·불쾌 수준은 불성립(2024도15087)',
  },
  언어폭력: {
    articleKeys: ['모욕', '명예훼손'],
    prosecution: '친고죄',
    needsPublicity: true,
    note: '맥락에 따라 모욕 또는 명예훼손으로 갈림. 구체적 사실 적시 여부가 기준(87도739)',
  },
  협박: {
    articleKeys: ['협박'],
    prosecution: '반의사불벌',
    needsPublicity: false,
    note: '1회로도 성립. 단 말다툼 중 일시적 분노 표시는 불성립(2006도546)',
  },
  스토킹: {
    articleKeys: ['스토킹', '스토킹정의'],
    prosecution: '없음',
    needsPublicity: false,
    note: '2023.7.11 반의사불벌 폐지 — 합의해도 절차 진행. 지속·반복 필요(2조2호). 1회여도 잠정조치 대상',
  },
  성희롱: {
    articleKeys: ['통신매체음란'],
    prosecution: '없음',
    needsPublicity: false,
    note: '공연성 불요 — 1:1 DM도 성립. 유죄 시 신상등록. 분노와 결합되어도 성립(2018도9775)',
  },
  집단따돌림: {
    articleKeys: ['학폭정의', '학폭조치'],
    prosecution: '없음',
    needsPublicity: false,
    note: '가해자 2명 이상 + 지속·반복 필요. 단독 행위면 따돌림 불성립. 피해자가 없는 방의 험담도 불성립(2017카합80876)',
  },
  갈취강요: {
    articleKeys: ['공갈', '강요'],
    prosecution: '없음',
    needsPublicity: false,
    note: '기프티콘·계정 갈취는 공갈, 셔틀·대리플레이 강요는 강요죄. 단톡방 다수 가담 시 강요죄 2항',
  },
};

/** 1:1 DM일 때 공연성 필요 조항의 대체 경로 */
export const DM_FALLBACK: HarmLawMeta = {
  articleKeys: ['반복전송_벌칙'],
  prosecution: '반의사불벌',
  needsPublicity: false,
  note: '1:1 DM은 공연성이 없어 모욕·명예훼손이 성립하지 않으므로 반복 전송 조항(정통망법 74조①3호)으로 검토',
};

/** 삭제·차단 트랙 — 처벌과 별개로 병행 */
export const REMOVAL_TRACK = {
  fast: {
    articleKey: '삭제요청',
    how: '피해자가 침해사실을 소명하여 플랫폼(네이버·카카오·인스타 등)에 직접 요청. 사업자는 지체 없이 삭제 또는 30일 이내 접근차단',
  },
  official: {
    articleKey: '불법정보유통금지',
    how: '방송통신심의위원회 심의 → 방통위 시정요구. 시간은 더 걸리지만 공적 강제력이 있음',
  },
} as const;

/** 민사 트랙 — 형사 미달 시에도 안내 */
export const CIVIL_TRACK = ['불법행위', '위자료', '감독자책임'];

export class LawRegistry {
  private readonly data: ArticleFile;

  constructor(
    jsonPath = path.join(process.cwd(), 'data', 'law-articles.json'),
  ) {
    this.data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as ArticleFile;
  }

  get collectedAt(): string {
    return this.data.수집일시;
  }

  /** 조문 하나 조회 */
  article(key: string): ArticleRecord | null {
    return this.data.조문[key] ?? null;
  }

  /** 유형 → 조문 목록. context가 'dm'이고 공연성이 필요하면 대체 경로로 전환 */
  resolve(
    harmType: string,
    isDm: boolean,
  ): { meta: HarmLawMeta; articles: ArticleRecord[] } | null {
    let meta = HARM_LAW_MAP[harmType];
    if (!meta) return null;
    if (meta.needsPublicity && isDm) meta = DM_FALLBACK;

    const articles = meta.articleKeys
      .map((k) => this.article(k))
      .filter((a): a is ArticleRecord => a !== null);
    return { meta, articles };
  }

  /**
   * 문서에 넣을 한 줄 — 조문명 + 형량.
   * 정의·금지 조문(스토킹처벌법 2조, 학폭법 2조 등)은 형량이 없으므로
   * 형량 대신 조문 제목을 쓴다.
   */
  summarize(a: ArticleRecord): string {
    const p = this.extractPenalty(a.본문);
    return p ? `${a.라벨} — ${p}` : `${a.라벨} (${a.조문제목})`;
  }

  /**
   * 조문 본문에서 형량을 **항 단위로** 추출.
   * 조문 전체에서 숫자만 긁으면 "3년 이하 / 5년 이하, 500만원 / 700만원"처럼
   * 어느 형량이 어느 항인지 뭉개진다. 항별로 짝지어야 정확하다.
   *
   * 원문 기반이므로 법이 개정되면 자동 반영된다.
   */
  extractPenalty(text: string): string {
    const JAIL =
      /(?:무기(?:징역)?|\d+년 이상의 유기징역|\d+년 이하의 (?:징역|금고|유기징역))/g;
    const FINE = /\d[\d,]*(?:천|백)?\d*만원|\d+억원/g;

    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const found: string[] = [];

    for (const line of lines) {
      const jail = line.match(JAIL) ?? [];
      const fine = line.match(FINE) ?? [];
      if (!jail.length && !fine.length) continue;

      // 항/호 번호를 앞에 붙여 어느 항의 형량인지 알 수 있게 한다
      const marker = line.match(/^([①-⑳]|\d+(?:의\d+)?\.)/)?.[1] ?? '';
      const body = [
        [...new Set(jail)].join(' 또는 '),
        [...new Set(fine)].map((f) => `${f} 이하 벌금`).join(' 또는 '),
      ]
        .filter(Boolean)
        .join(', ');

      found.push(marker ? `${marker} ${body}` : body);
    }

    if (found.length === 0) return '';
    // 항이 하나뿐이면 번호 없이 (조문 전체가 단일 형량인 경우)
    if (found.length === 1) return found[0].replace(/^[①-⑳]\s*/, '');
    return found.join(' · ');
  }

  /** 소추요건 안내 문구 */
  prosecutionNotice(p: Prosecution): string {
    switch (p) {
      case '친고죄':
        return '친고죄 — 가해자를 안 날부터 6개월 이내에 고소해야 합니다.';
      case '반의사불벌':
        return '반의사불벌죄 — 합의하면 처벌할 수 없습니다.';
      case '없음':
        return '합의하더라도 수사·처벌 절차가 진행될 수 있습니다.';
    }
  }
}
