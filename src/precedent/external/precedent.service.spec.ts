import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { PrecedentService } from './precedent.service';

describe('PrecedentService', () => {
  const httpGet = jest.fn();
  const configGet = jest.fn().mockReturnValue('test');
  const httpService = { get: httpGet } as unknown as HttpService;
  const configService = { get: configGet } as unknown as ConfigService;
  const service = new PrecedentService(configService, httpService);

  beforeEach(() => {
    httpGet.mockReset();
    configGet.mockClear();
  });

  it('판례 목록 응답을 변환한다', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          PrecSearch: {
            키워드: '담보권',
            page: '1',
            totalCnt: '1',
            section: 'evtNm',
            prec: [
              {
                id: '1',
                사건번호: '2024다12345',
                데이터출처명: '대법원',
                사건종류코드: '400101',
                사건종류명: '민사',
                선고: '선고',
                선고일자: '2024.01.01',
                판례일련번호: '12345',
                판결유형: '판결',
                법원종류코드: '400201',
                법원명: '대법원',
                판례상세링크: '/DRF/lawService.do',
                사건명: '손해배상',
              },
            ],
          },
        },
      } as AxiosResponse),
    );

    const result = await service.getPrecedents({
      query: '담보권',
      search: 1,
      display: 10,
      page: 1,
      sort: 'ddes',
    });

    expect(result).toEqual({
      totalCount: 1,
      page: 1,
      query: '담보권',
      searchType: 'evtNm',
      precedents: [
        {
          id: '12345',
          caseNumber: '2024다12345',
          caseName: '손해배상',
          courtName: '대법원',
          courtTypeCode: '400201',
          judgementDate: '2024.01.01',
          sentenceType: '선고',
          caseType: '민사',
          caseTypeCode: '400101',
          judgementType: '판결',
          dataSource: '대법원',
        },
      ],
    });
  });

  it('판례 본문 응답의 HTML 줄바꿈을 정리한다', async () => {
    httpGet.mockReturnValue(
      of({
        data: {
          PrecService: {
            판례정보일련번호: '228541',
            사건번호: '2021도3451',
            사건명: '강제추행',
            법원명: '대법원',
            선고일자: '20220819',
            판시사항: '<![CDATA[판시<br/>사항]]>',
            판결요지: '판결<br>요지',
            참조조문: '형법 제298조',
            참조판례: '대법원 판례',
            판례내용: '<p>본문</p>',
          },
        },
      } as AxiosResponse),
    );

    const result = await service.getPrecedent(228541);

    expect(result.summary).toBe('판시\n사항');
    expect(result.gist).toBe('판결\n요지');
    expect(result.fullContent).toBe('본문');
  });

  it('조회 개수가 범위를 벗어나면 요청을 거부한다', async () => {
    await expect(
      service.getPrecedents({
        query: '*',
        search: 1,
        display: 101,
        page: 1,
        sort: 'ddes',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(httpGet).not.toHaveBeenCalled();
  });
});
