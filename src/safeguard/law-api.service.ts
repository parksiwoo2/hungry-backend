/**
 * 국가법령정보 Open API 연동 (open.law.go.kr)
 *
 * 용도 — 런타임에 매번 부르지 않는다. 두 가지 목적에만 쓴다:
 *   1. 동기화: LAW_MAP에 넣을 조문 원문·시행일자를 정확히 가져와 JSON으로 저장 (주기 실행)
 *   2. 개정 감지: 저장된 시행일자와 API의 시행일자가 다르면 경고 → 사람이 LAW_MAP 갱신
 *
 * 왜 런타임 호출을 안 하나:
 *   - 법은 몇 달~몇 년 단위로 바뀌는데 분석은 초 단위로 일어난다
 *   - 외부 API 장애가 분석 실패로 전파되면 안 된다
 *   - 우리가 쓰는 조문은 15개 내외로 고정
 *
 * 검증 완료 (2026-07-31 실호출):
 *   - 조문 단위 조회 가능 (JO 파라미터)
 *   - 형법 311조·283조, 정통망법 70조·44조의2, 스토킹처벌법 18조,
 *     성폭법 14조의2, 민법 751조, 형법 350조 — 8건 전부 성공
 */
import { Injectable, Logger } from '@nestjs/common';

const BASE = 'http://www.law.go.kr/DRF';

/**
 * 동기화 대상 조문 목록 — law-articles.json 의 키와 1:1로 대응한다.
 * HARM_LAW_MAP · REMOVAL_TRACK · CIVIL_TRACK 이 실제로 참조하는 조문만 담는다.
 *
 * 유형을 추가할 때는 여기에 한 줄 넣고 snapshotAll() 을 다시 돌리면 된다.
 * 반대로 여기서 빼면 다음 동기화 때 JSON에서도 사라지므로, 참조가 남아 있는지 먼저 확인할 것.
 *
 * JO = 조번호 4자리 + 가지번호 2자리 (제311조 → 031100, 제44조의2 → 004402)
 */
export const TRACKED_ARTICLES = [
  // 형법
  { key: '협박', lawName: '형법', jo: '028300', label: '형법 제283조(협박)' },
  { key: '모욕', lawName: '형법', jo: '031100', label: '형법 제311조(모욕)' },
  { key: '강요', lawName: '형법', jo: '032400', label: '형법 제324조(강요)' },
  { key: '공갈', lawName: '형법', jo: '035000', label: '형법 제350조(공갈)' },
  // 정보통신망 이용촉진 및 정보보호 등에 관한 법률
  {
    key: '삭제요청',
    lawName: '정보통신망 이용촉진 및 정보보호 등에 관한 법률',
    jo: '004402',
    label: '정통망법 제44조의2(삭제요청)',
  },
  {
    key: '불법정보유통금지',
    lawName: '정보통신망 이용촉진 및 정보보호 등에 관한 법률',
    jo: '004407',
    label: '정통망법 제44조의7(불법정보 유통금지)',
  },
  {
    key: '명예훼손',
    lawName: '정보통신망 이용촉진 및 정보보호 등에 관한 법률',
    jo: '007000',
    label: '정통망법 제70조(벌칙-명예훼손)',
  },
  {
    key: '반복전송_벌칙',
    lawName: '정보통신망 이용촉진 및 정보보호 등에 관한 법률',
    jo: '007400',
    label: '정통망법 제74조(벌칙)',
  },
  // 스토킹범죄의 처벌 등에 관한 법률
  {
    key: '스토킹정의',
    lawName: '스토킹범죄의 처벌 등에 관한 법률',
    jo: '000200',
    label: '스토킹처벌법 제2조(정의)',
  },
  {
    key: '스토킹',
    lawName: '스토킹범죄의 처벌 등에 관한 법률',
    jo: '001800',
    label: '스토킹처벌법 제18조(스토킹범죄)',
  },
  // 성폭력범죄의 처벌 등에 관한 특례법
  {
    key: '통신매체음란',
    lawName: '성폭력범죄의 처벌 등에 관한 특례법',
    jo: '001300',
    label: '성폭법 제13조(통신매체이용음란)',
  },
  // 학교폭력예방 및 대책에 관한 법률
  {
    key: '학폭정의',
    lawName: '학교폭력예방 및 대책에 관한 법률',
    jo: '000200',
    label: '학폭법 제2조(정의)',
  },
  {
    key: '학폭조치',
    lawName: '학교폭력예방 및 대책에 관한 법률',
    jo: '001700',
    label: '학폭법 제17조(가해학생 조치)',
  },
  // 민법
  {
    key: '불법행위',
    lawName: '민법',
    jo: '075000',
    label: '민법 제750조(불법행위)',
  },
  {
    key: '위자료',
    lawName: '민법',
    jo: '075100',
    label: '민법 제751조(재산 이외의 손해)',
  },
  {
    key: '감독자책임',
    lawName: '민법',
    jo: '075500',
    label: '민법 제755조(감독자책임)',
  },
] as const;

export interface ArticleSnapshot {
  key: string;
  label: string;
  title: string; // 조문제목 (예: "모욕")
  text: string; // 조문 전문 (항 포함)
  effectiveDate: string; // 조문시행일자 — 개정 감지의 기준
  fetchedAt: string;
}

/** API 원본 응답 (필요한 필드만) */
interface LawSearchRow {
  법령명한글?: string;
  법령일련번호?: string | number;
}

interface PrecRow {
  사건번호?: string;
  사건명?: string;
  법원명?: string;
  선고일자?: string;
  판결유형?: string;
  판례상세링크?: string;
}

interface ArticleUnit {
  조문여부?: string;
  조문번호?: string;
  조문제목?: string;
  조문내용?: string;
  조문시행일자?: string;
  항?:
    | { 항번호?: string; 항내용?: string }
    | { 항번호?: string; 항내용?: string }[];
}

@Injectable()
export class LawApiService {
  private readonly logger = new Logger(LawApiService.name);
  private readonly oc: string;
  private readonly mstCache = new Map<string, string>();

  constructor() {
    // .env 의 API_KEY 를 OC 파라미터로 사용 (main.ts 의 loadEnv 가 채움)
    this.oc = process.env.API_KEY ?? 'test';
  }

  private async fetchJson(path: string, params: Record<string, string>) {
    const qs = new URLSearchParams({ OC: this.oc, type: 'JSON', ...params });
    const res = await fetch(`${BASE}/${path}?${qs}`, {
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`법령 API ${res.status}`);
    return (await res.json()) as unknown;
  }

  /** 법령명 → 법령일련번호(MST). 동일 이름 우선 매칭 */
  private async findMst(lawName: string): Promise<string> {
    const cached = this.mstCache.get(lawName);
    if (cached) return cached;

    const data = (await this.fetchJson('lawSearch.do', {
      target: 'law',
      query: lawName,
      display: '20',
    })) as { LawSearch?: { law?: LawSearchRow | LawSearchRow[] } };
    const raw = data.LawSearch?.law;
    const list: LawSearchRow[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const hit = list.find((x) => x.법령명한글 === lawName);
    if (!hit) throw new Error(`법령을 찾을 수 없음: ${lawName}`);

    const mst = String(hit.법령일련번호);
    this.mstCache.set(lawName, mst);
    return mst;
  }

  /** 조문 하나를 원문 그대로 가져온다 */
  async fetchArticle(
    lawName: string,
    jo: string,
  ): Promise<{ title: string; text: string; effectiveDate: string }> {
    const mst = await this.findMst(lawName);
    const data = (await this.fetchJson('lawService.do', {
      target: 'law',
      MST: mst,
      JO: jo,
    })) as { 법령?: { 조문?: { 조문단위?: ArticleUnit | ArticleUnit[] } } };

    const raw = data.법령?.조문?.조문단위;
    const units: ArticleUnit[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    // 배열 첫 항목이 "제30장 협박의 죄" 같은 편·장 제목인 경우가 있어 조문여부로 걸러야 한다
    const unit =
      units.find((u) => u.조문여부 === '조문') ?? units[units.length - 1];
    if (!unit) throw new Error(`조문 없음: ${lawName} JO=${jo}`);

    // 항이 여러 개면 조문내용에는 제목만 있고 실제 내용은 항 배열에 있다
    const hangRaw = unit.항;
    const hangs = Array.isArray(hangRaw) ? hangRaw : hangRaw ? [hangRaw] : [];
    const body = hangs
      .map((h) => this.normalize(h.항내용 ?? ''))
      .filter(Boolean)
      .join('\n');

    const head = this.normalize(unit.조문내용 ?? '');
    return {
      title: unit.조문제목 ?? '',
      text: body ? `${head}\n${body}` : head,
      effectiveDate: String(unit.조문시행일자 ?? ''),
    };
  }

  private normalize(s: string): string {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  /** 추적 대상 조문 전체를 한 번에 수집 — 동기화 스크립트에서 호출 */
  async snapshotAll(): Promise<ArticleSnapshot[]> {
    const out: ArticleSnapshot[] = [];
    for (const a of TRACKED_ARTICLES) {
      try {
        const r = await this.fetchArticle(a.lawName, a.jo);
        out.push({
          key: a.key,
          label: a.label,
          title: r.title,
          text: r.text,
          effectiveDate: r.effectiveDate,
          fetchedAt: new Date().toISOString(),
        });
      } catch (e) {
        this.logger.error(`${a.label} 수집 실패: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 300)); // 연속 호출 간격
    }
    return out;
  }

  /**
   * 개정 감지 — 저장해둔 스냅샷과 현재 API를 비교.
   * 시행일자가 달라졌으면 LAW_MAP의 형량·요건을 사람이 다시 확인해야 한다.
   */
  async detectAmendments(
    saved: ArticleSnapshot[],
  ): Promise<{ label: string; savedDate: string; currentDate: string }[]> {
    const changes: { label: string; savedDate: string; currentDate: string }[] =
      [];
    for (const s of saved) {
      const meta = TRACKED_ARTICLES.find((a) => a.key === s.key);
      if (!meta) continue;
      try {
        const cur = await this.fetchArticle(meta.lawName, meta.jo);
        if (cur.effectiveDate && cur.effectiveDate !== s.effectiveDate) {
          changes.push({
            label: s.label,
            savedDate: s.effectiveDate,
            currentDate: cur.effectiveDate,
          });
        }
      } catch (e) {
        this.logger.warn(`${s.label} 개정 확인 실패: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return changes;
  }

  /** 사용자에게 보여줄 법령 원문 링크 (API 호출 없이 조립만) */
  buildLawLink(lawName: string): string {
    return `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`;
  }

  /** 판례 검색 — 레퍼런스의 '사건번호 미확인' 항목을 확인할 때 사용 */
  async searchPrecedent(query: string, display = 10) {
    const data = (await this.fetchJson('lawSearch.do', {
      target: 'prec',
      query,
      display: String(display),
    })) as { PrecSearch?: { prec?: PrecRow | PrecRow[] } };
    const raw = data.PrecSearch?.prec;
    const list: PrecRow[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((p) => ({
      caseNo: p.사건번호,
      caseName: p.사건명,
      court: p.법원명,
      date: p.선고일자,
      type: p.판결유형,
      link: `https://www.law.go.kr${p.판례상세링크 ?? ''}`,
    }));
  }
}
