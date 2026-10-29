import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PrecedentEntity } from '../entities/precedent.entity';
import type {
  PrecedentDetailResult,
  PrecedentHtmlDetailResult,
  PrecedentListItem,
} from '../external/precedent.service';

export interface StoredPrecedentSearchOptions {
  page: number;
  limit: number;
  category?: string;
  query?: string;
}

export interface PrecedentDetailTarget {
  id: string;
  dataSource: string | null;
}

export interface StoredPrecedentDetail {
  id: string;
  caseNumber: string | null;
  caseName: string | null;
  courtName: string | null;
  courtTypeCode: string | null;
  judgementDate: string | null;
  sentenceType: string | null;
  caseType: string | null;
  caseTypeCode: string | null;
  judgementType: string | null;
  dataSource: string | null;
  summary: string | null;
  gist: string | null;
  refLaws: string | null;
  refCases: string | null;
  fullContent: string | null;
  matchedCategories: string[];
  matchedQueries: string[];
  detailStatus: string;
  detailError: string | null;
  detailFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrecedentStoreService {
  constructor(
    @InjectRepository(PrecedentEntity)
    private readonly precedentRepository: Repository<PrecedentEntity>,
  ) {}

  async saveSearchResults(
    items: PrecedentListItem[],
    category: string,
    query: string,
  ): Promise<number> {
    const validItems = items.filter((item) => item.id);

    if (validItems.length === 0) {
      return 0;
    }

    const ids = [...new Set(validItems.map((item) => item.id))];
    const existing = await this.precedentRepository.findBy({
      externalId: In(ids),
    });
    const existingById = new Map(
      existing.map((precedent) => [precedent.externalId, precedent]),
    );
    const entities = validItems.map((item) => {
      const precedent =
        existingById.get(item.id) ??
        this.precedentRepository.create({
          externalId: item.id,
          matchedCategories: [],
          matchedQueries: [],
          detailFetchedAt: null,
          detailStatus: 'pending',
        });

      precedent.caseNumber = item.caseNumber || null;
      precedent.caseName = item.caseName || null;
      precedent.courtName = item.courtName || null;
      precedent.courtTypeCode = item.courtTypeCode || null;
      precedent.judgementDate = item.judgementDate || null;
      precedent.sentenceType = item.sentenceType || null;
      precedent.caseType = item.caseType || null;
      precedent.caseTypeCode = item.caseTypeCode || null;
      precedent.judgementType = item.judgementType || null;
      precedent.dataSource = item.dataSource || null;
      precedent.matchedCategories = this.mergeValues(
        precedent.matchedCategories,
        category,
      );
      precedent.matchedQueries = this.mergeValues(
        precedent.matchedQueries,
        query,
      );
      return precedent;
    });

    await this.precedentRepository.save(entities, { chunk: 100 });
    return entities.length;
  }

  async saveDetail(detail: PrecedentDetailResult): Promise<void> {
    const precedent =
      (await this.precedentRepository.findOneBy({ externalId: detail.id })) ??
      this.precedentRepository.create({
        externalId: detail.id,
        matchedCategories: [],
        matchedQueries: [],
        detailStatus: 'pending',
      });

    precedent.caseNumber = detail.caseNumber || precedent.caseNumber || null;
    precedent.caseName = detail.caseName || precedent.caseName || null;
    precedent.courtName = detail.courtName || precedent.courtName || null;
    precedent.courtTypeCode =
      detail.courtTypeCode || precedent.courtTypeCode || null;
    precedent.judgementDate =
      detail.judgementDate || precedent.judgementDate || null;
    precedent.sentenceType =
      detail.sentenceType || precedent.sentenceType || null;
    precedent.caseType = detail.caseType || precedent.caseType || null;
    precedent.caseTypeCode =
      detail.caseTypeCode || precedent.caseTypeCode || null;
    precedent.judgementType =
      detail.judgementType || precedent.judgementType || null;
    precedent.summary = detail.summary || null;
    precedent.gist = detail.gist || null;
    precedent.refLaws = detail.refLaws || null;
    precedent.refCases = detail.refCases || null;
    precedent.fullContent = detail.fullContent || null;
    precedent.detailStatus = 'json';
    precedent.detailError = null;
    precedent.detailFetchedAt = new Date();

    await this.precedentRepository.save(precedent);
  }

  async saveHtmlDetail(detail: PrecedentHtmlDetailResult): Promise<void> {
    const precedent = await this.precedentRepository.findOneBy({
      externalId: detail.id,
    });

    if (!precedent) {
      throw new NotFoundException('HTML 본문을 저장할 판례가 없습니다.');
    }

    precedent.rawDetailHtml = detail.rawHtml;
    precedent.fullContent = detail.fullContent || null;
    precedent.detailStatus = 'html';
    precedent.detailError = null;
    precedent.detailFetchedAt = new Date();
    await this.precedentRepository.save(precedent);
  }

  async saveDetailError(id: string, message: string): Promise<void> {
    await this.precedentRepository.update(
      { externalId: id },
      { detailError: message },
    );
  }

  async findMissingDetailIds(ids: string[]): Promise<string[]> {
    const missing: string[] = [];

    for (let index = 0; index < ids.length; index += 500) {
      const chunk = ids.slice(index, index + 500);
      const precedents = await this.precedentRepository.findBy({
        externalId: In(chunk),
      });
      const detailedIds = new Set(
        precedents
          .filter((precedent) => precedent.detailFetchedAt)
          .map((precedent) => precedent.externalId),
      );
      missing.push(...chunk.filter((id) => !detailedIds.has(id)));
    }

    return missing;
  }

  async findMissingDetails(ids: string[]): Promise<PrecedentDetailTarget[]> {
    const targets: PrecedentDetailTarget[] = [];

    for (let index = 0; index < ids.length; index += 500) {
      const chunk = ids.slice(index, index + 500);
      const precedents = await this.precedentRepository.findBy({
        externalId: In(chunk),
      });
      targets.push(
        ...precedents
          .filter((precedent) => !precedent.detailFetchedAt)
          .map((precedent) => ({
            id: precedent.externalId,
            dataSource: precedent.dataSource,
          })),
      );
    }

    return targets;
  }

  async findAllIds(): Promise<string[]> {
    const precedents = await this.precedentRepository.find({
      select: { externalId: true },
      order: { externalId: 'ASC' },
    });
    return precedents.map((precedent) => precedent.externalId);
  }

  async findAll(options: StoredPrecedentSearchOptions) {
    const page = Math.max(1, options.page);
    const limit = Math.min(100, Math.max(1, options.limit));
    const queryBuilder = this.precedentRepository
      .createQueryBuilder('precedent')
      .orderBy('precedent.judgement_date', 'DESC')
      .addOrderBy('precedent.external_id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (options.category) {
      queryBuilder.andWhere(':category = ANY(precedent.matched_categories)', {
        category: options.category,
      });
    }

    if (options.query) {
      queryBuilder.andWhere(
        `(precedent.case_name ILIKE :query
          OR precedent.case_number ILIKE :query
          OR precedent.court_name ILIKE :query
          OR precedent.summary ILIKE :query
          OR precedent.gist ILIKE :query
          OR precedent.full_content ILIKE :query
          OR array_to_string(precedent.matched_queries, ' ') ILIKE :query)`,
        { query: `%${options.query}%` },
      );
    }

    const [precedents, totalCount] = await queryBuilder.getManyAndCount();

    return {
      totalCount,
      page,
      limit,
      precedents: precedents.map((precedent) => ({
        id: precedent.externalId,
        caseNumber: precedent.caseNumber,
        caseName: precedent.caseName,
        courtName: precedent.courtName,
        judgementDate: precedent.judgementDate,
        caseType: precedent.caseType,
        judgementType: precedent.judgementType,
        dataSource: precedent.dataSource,
        matchedCategories: precedent.matchedCategories,
        matchedQueries: precedent.matchedQueries,
        detailFetched: Boolean(precedent.detailFetchedAt),
        detailStatus: precedent.detailStatus,
        detailError: precedent.detailError,
      })),
    };
  }

  async findOne(id: string): Promise<StoredPrecedentDetail> {
    const precedent = await this.precedentRepository.findOneBy({
      externalId: id,
    });

    if (!precedent) {
      throw new NotFoundException('저장된 판례를 찾을 수 없습니다.');
    }

    return {
      id: precedent.externalId,
      caseNumber: precedent.caseNumber,
      caseName: precedent.caseName,
      courtName: precedent.courtName,
      courtTypeCode: precedent.courtTypeCode,
      judgementDate: precedent.judgementDate,
      sentenceType: precedent.sentenceType,
      caseType: precedent.caseType,
      caseTypeCode: precedent.caseTypeCode,
      judgementType: precedent.judgementType,
      dataSource: precedent.dataSource,
      summary: precedent.summary,
      gist: precedent.gist,
      refLaws: precedent.refLaws,
      refCases: precedent.refCases,
      fullContent: precedent.fullContent,
      matchedCategories: precedent.matchedCategories,
      matchedQueries: precedent.matchedQueries,
      detailStatus: precedent.detailStatus,
      detailError: precedent.detailError,
      detailFetchedAt: precedent.detailFetchedAt,
      createdAt: precedent.createdAt,
      updatedAt: precedent.updatedAt,
    };
  }

  private mergeValues(values: string[] | null, value: string): string[] {
    return [...new Set([...(values ?? []), value])];
  }
}
