import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { OpenAiPrecedentService } from '../analysis/openai-precedent.service';
import { PrecedentHybridSearchService } from './precedent-hybrid-search.service';

describe('PrecedentHybridSearchService', () => {
  const query = jest.fn();
  const createEmbeddings = jest.fn();
  const service = new PrecedentHybridSearchService(
    { query } as unknown as DataSource,
    { createEmbeddings } as unknown as OpenAiPrecedentService,
  );

  beforeEach(() => {
    query.mockReset().mockResolvedValue([]);
    createEmbeddings.mockReset().mockResolvedValue([Array(1536).fill(0.1)]);
  });

  it('한 검색어로 자연어 임베딩과 자동 추출 키워드를 함께 검색한다', async () => {
    const result = await service.search({
      query: '단톡방에서 친구를 모욕한 경우 공연성',
      mode: 'hybrid',
      limit: 3,
      offset: 6,
      filters: {
        crimeTypes: ['모욕죄'],
      },
    });

    expect(createEmbeddings).toHaveBeenCalledWith([
      '단톡방에서 친구를 모욕한 경우 공연성',
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      expect.stringContaining('0.1'),
      '단톡방에서 친구를 모욕한 경우 공연성',
      'hybrid',
      null,
      ['모욕죄'],
      null,
      3,
      6,
      expect.stringContaining('단톡방에서 | 단톡방'),
      expect.arrayContaining([
        '단톡방',
        '단체채팅방',
        '친구',
        '모욕',
        '공연성',
      ]),
    ]);
    expect(result.results).toEqual([]);
  });

  it('잘못된 검색 모드는 API 호출 전에 거부한다', async () => {
    await expect(
      service.search({ query: '모욕', mode: 'unknown' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });
});
