import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface LawPrecedentListItem {
  id: string;
  사건번호: string;
  데이터출처명: string;
  사건종류코드: string;
  사건종류명: string;
  선고: string;
  선고일자: string;
  판례일련번호: string;
  판결유형: string;
  법원종류코드: string;
  법원명: string;
  판례상세링크: string;
  사건명: string;
}

interface LawPrecedentSearchResponse {
  PrecSearch?: {
    키워드?: string;
    page?: string;
    target?: string;
    prec?: LawPrecedentListItem | LawPrecedentListItem[];
    totalCnt?: string;
    section?: string;
  };
  result?: string;
  msg?: string;
}

interface LawPrecedentDetail {
  판시사항?: string;
  참조판례?: string;
  사건종류명?: string;
  판결요지?: string;
  참조조문?: string;
  선고일자?: string;
  법원명?: string;
  사건명?: string;
  판례내용?: string;
  사건번호?: string;
  사건종류코드?: string;
  판례정보일련번호?: string;
  선고?: string;
  판결유형?: string;
  법원종류코드?: string;
}

interface LawPrecedentDetailResponse {
  PrecService?: LawPrecedentDetail;
  result?: string;
  msg?: string;
}

export interface PrecedentSearchOptions {
  query: string;
  search: number;
  display: number;
  page: number;
  sort: string;
}

export interface PrecedentListItem {
  id: string;
  caseNumber: string;
  caseName: string;
  courtName: string;
  courtTypeCode: string;
  judgementDate: string;
  sentenceType: string;
  caseType: string;
  caseTypeCode: string;
  judgementType: string;
  dataSource: string;
}

export interface PrecedentSearchResult {
  totalCount: number;
  page: number;
  query: string;
  searchType: string;
  precedents: PrecedentListItem[];
}

export interface PrecedentDetailResult {
  id: string;
  caseNumber: string;
  caseName: string;
  courtName: string;
  courtTypeCode: string;
  judgementDate: string;
  sentenceType: string;
  caseType: string;
  caseTypeCode: string;
  judgementType: string;
  summary: string;
  gist: string;
  refLaws: string;
  refCases: string;
  fullContent: string;
}

export interface PrecedentHtmlDetailResult {
  id: string;
  rawHtml: string;
  fullContent: string;
}

@Injectable()
export class PrecedentService {
  private readonly baseUrl = 'https://www.law.go.kr/DRF';
  private readonly allowedSorts = new Set([
    'lasc',
    'ldes',
    'dasc',
    'ddes',
    'nasc',
    'ndes',
  ]);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async getPrecedents(
    options: PrecedentSearchOptions,
  ): Promise<PrecedentSearchResult> {
    this.validateSearchOptions(options);
    const oc = this.getApiKey();

    try {
      const response = await firstValueFrom(
        this.httpService.get<LawPrecedentSearchResponse>(
          `${this.baseUrl}/lawSearch.do`,
          {
            params: {
              OC: oc,
              target: 'prec',
              type: 'JSON',
              query: options.query || '*',
              search: options.search,
              display: options.display,
              page: options.page,
              sort: options.sort,
            },
          },
        ),
      );

      return this.transformSearchResponse(response.data);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadGatewayException(
        '국가법령정보센터 판례 목록 조회에 실패했습니다.',
      );
    }
  }

  async getPrecedent(id: number): Promise<PrecedentDetailResult> {
    const oc = this.getApiKey();

    try {
      const response = await firstValueFrom(
        this.httpService.get<LawPrecedentDetailResponse>(
          `${this.baseUrl}/lawService.do`,
          {
            params: {
              OC: oc,
              target: 'prec',
              type: 'JSON',
              ID: id,
            },
          },
        ),
      );

      return this.transformDetailResponse(response.data);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadGatewayException(
        '국가법령정보센터 판례 본문 조회에 실패했습니다.',
      );
    }
  }

  async getPrecedentHtml(id: number): Promise<PrecedentHtmlDetailResult> {
    const oc = this.getApiKey();

    try {
      const response = await firstValueFrom(
        this.httpService.get<string>(`${this.baseUrl}/lawService.do`, {
          params: {
            OC: oc,
            target: 'prec',
            type: 'HTML',
            ID: id,
          },
          responseType: 'text',
        }),
      );

      return {
        id: String(id),
        rawHtml: response.data,
        fullContent: this.cleanHtml(response.data),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadGatewayException(
        '국가법령정보센터 판례 HTML 본문 조회에 실패했습니다.',
      );
    }
  }

  private getApiKey(): string {
    const oc = this.configService.get<string>('LAW_API_OC');

    if (!oc) {
      throw new InternalServerErrorException(
        'LAW_API_OC 환경 변수가 설정되지 않았습니다.',
      );
    }

    return oc;
  }

  private validateSearchOptions(options: PrecedentSearchOptions): void {
    if (options.search !== 1 && options.search !== 2) {
      throw new BadRequestException('search는 1 또는 2여야 합니다.');
    }

    if (options.display < 1 || options.display > 100) {
      throw new BadRequestException('display는 1부터 100까지 입력해야 합니다.');
    }

    if (options.page < 1) {
      throw new BadRequestException('page는 1 이상이어야 합니다.');
    }

    if (!this.allowedSorts.has(options.sort)) {
      throw new BadRequestException('지원하지 않는 sort 값입니다.');
    }
  }

  private transformSearchResponse(
    data: LawPrecedentSearchResponse,
  ): PrecedentSearchResult {
    const result = data.PrecSearch;

    if (!result) {
      throw new BadGatewayException(
        this.getInvalidResponseMessage(
          data,
          '판례 목록 응답 형식이 올바르지 않습니다.',
        ),
      );
    }

    const precedents = result.prec
      ? Array.isArray(result.prec)
        ? result.prec
        : [result.prec]
      : [];

    return {
      totalCount: Number(result.totalCnt ?? 0),
      page: Number(result.page ?? 1),
      query: result.키워드 ?? '',
      searchType: result.section ?? '',
      precedents: precedents.map((precedent) => ({
        id: precedent.판례일련번호 ?? '',
        caseNumber: precedent.사건번호 ?? '',
        caseName: precedent.사건명 ?? '',
        courtName: precedent.법원명 ?? '',
        courtTypeCode: precedent.법원종류코드 ?? '',
        judgementDate: precedent.선고일자 ?? '',
        sentenceType: precedent.선고 ?? '',
        caseType: precedent.사건종류명 ?? '',
        caseTypeCode: precedent.사건종류코드 ?? '',
        judgementType: precedent.판결유형 ?? '',
        dataSource: precedent.데이터출처명 ?? '',
      })),
    };
  }

  private transformDetailResponse(
    data: LawPrecedentDetailResponse,
  ): PrecedentDetailResult {
    const precedent = data.PrecService;

    if (!precedent) {
      throw new BadGatewayException(
        this.getInvalidResponseMessage(
          data,
          '판례 본문 응답 형식이 올바르지 않습니다.',
        ),
      );
    }

    return {
      id: precedent.판례정보일련번호 ?? '',
      caseNumber: precedent.사건번호 ?? '',
      caseName: precedent.사건명 ?? '',
      courtName: precedent.법원명 ?? '',
      courtTypeCode: precedent.법원종류코드 ?? '',
      judgementDate: precedent.선고일자 ?? '',
      sentenceType: precedent.선고 ?? '',
      caseType: precedent.사건종류명 ?? '',
      caseTypeCode: precedent.사건종류코드 ?? '',
      judgementType: precedent.판결유형 ?? '',
      summary: this.cleanText(precedent.판시사항),
      gist: this.cleanText(precedent.판결요지),
      refLaws: this.cleanText(precedent.참조조문),
      refCases: this.cleanText(precedent.참조판례),
      fullContent: this.cleanText(precedent.판례내용),
    };
  }

  private getInvalidResponseMessage(
    data: { result?: string; msg?: string },
    fallback: string,
  ): string {
    return [data.result, data.msg].filter(Boolean).join(' ') || fallback;
  }

  private cleanText(text?: string): string {
    if (!text) {
      return '';
    }

    return text
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim();
  }

  private cleanHtml(html: string): string {
    return this.cleanText(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, '\n'),
    ).replace(/\n{3,}/g, '\n\n');
  }
}
