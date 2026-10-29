import { Injectable, Logger } from '@nestjs/common';
import {
  PRECEDENT_QUERY_CATALOG,
  PrecedentQueryDefinition,
} from './precedent-query.catalog';
import { PrecedentStoreService } from '../storage/precedent-store.service';
import { PrecedentSearchResult, PrecedentService } from './precedent.service';

interface SyncFailure {
  target: string;
  message: string;
}

export interface PrecedentSyncSummary {
  startedAt: string;
  finishedAt: string;
  queryCount: number;
  matchedRows: number;
  uniquePrecedents: number;
  detailsRequested: number;
  detailsSaved: number;
  detailsSkipped: number;
  queryFailures: SyncFailure[];
  detailFailures: SyncFailure[];
}

export interface PrecedentDetailSyncSummary {
  startedAt: string;
  finishedAt: string;
  totalPrecedents: number;
  detailsRequested: number;
  detailsSaved: number;
  detailsSkipped: number;
  detailFailures: SyncFailure[];
}

@Injectable()
export class PrecedentSyncService {
  private readonly logger = new Logger(PrecedentSyncService.name);
  private readonly display = 100;
  private readonly requestDelayMs = 150;
  private readonly detailConcurrency = 3;

  constructor(
    private readonly precedentService: PrecedentService,
    private readonly precedentStoreService: PrecedentStoreService,
  ) {}

  async syncAll(): Promise<PrecedentSyncSummary> {
    const startedAt = new Date();
    const precedentIds = new Set<string>();
    const queryFailures: SyncFailure[] = [];
    let matchedRows = 0;

    for (const [index, definition] of PRECEDENT_QUERY_CATALOG.entries()) {
      try {
        const count = await this.syncQuery(definition, precedentIds);
        matchedRows += count;
        this.logger.log(
          `[${index + 1}/${PRECEDENT_QUERY_CATALOG.length}] ${definition.category} / ${definition.query}: ${count}건`,
        );
      } catch (error) {
        const message = this.getErrorMessage(error);
        queryFailures.push({ target: definition.query, message });
        this.logger.error(`${definition.query} 목록 수집 실패: ${message}`);
      }
    }

    const allIds = [...precedentIds];
    const detailSummary = await this.syncDetails(allIds);

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      queryCount: PRECEDENT_QUERY_CATALOG.length,
      matchedRows,
      uniquePrecedents: allIds.length,
      detailsRequested: detailSummary.detailsRequested,
      detailsSaved: detailSummary.detailsSaved,
      detailsSkipped: detailSummary.detailsSkipped,
      queryFailures,
      detailFailures: detailSummary.detailFailures,
    };
  }

  async syncMissingDetails(): Promise<PrecedentDetailSyncSummary> {
    const ids = await this.precedentStoreService.findAllIds();
    return this.syncDetails(ids);
  }

  private async syncQuery(
    definition: PrecedentQueryDefinition,
    precedentIds: Set<string>,
  ): Promise<number> {
    const firstPage = await this.fetchPage(definition.query, 1);
    let matchedRows = await this.savePage(firstPage, definition, precedentIds);
    const pageCount = Math.ceil(firstPage.totalCount / this.display);

    for (let page = 2; page <= pageCount; page += 1) {
      await this.delay(this.requestDelayMs);
      const result = await this.fetchPage(definition.query, page);
      matchedRows += await this.savePage(result, definition, precedentIds);
    }

    await this.delay(this.requestDelayMs);
    return matchedRows;
  }

  private fetchPage(
    query: string,
    page: number,
  ): Promise<PrecedentSearchResult> {
    return this.withRetry(() =>
      this.precedentService.getPrecedents({
        query,
        search: 2,
        display: this.display,
        page,
        sort: 'ddes',
      }),
    );
  }

  private async savePage(
    result: PrecedentSearchResult,
    definition: PrecedentQueryDefinition,
    precedentIds: Set<string>,
  ): Promise<number> {
    result.precedents.forEach((precedent) => precedentIds.add(precedent.id));
    await this.precedentStoreService.saveSearchResults(
      result.precedents,
      definition.category,
      definition.query,
    );
    return result.precedents.length;
  }

  private async syncDetails(
    ids: string[],
  ): Promise<PrecedentDetailSyncSummary> {
    const startedAt = new Date();
    const missingDetails =
      await this.precedentStoreService.findMissingDetails(ids);
    const detailFailures: SyncFailure[] = [];
    let nextIndex = 0;
    let processed = 0;
    let detailsSaved = 0;

    const worker = async () => {
      while (nextIndex < missingDetails.length) {
        const index = nextIndex;
        nextIndex += 1;
        const target = missingDetails[index];
        const id = target.id;

        try {
          if (target.dataSource === '국세법령정보시스템') {
            const detail = await this.precedentService.getPrecedentHtml(
              Number(id),
            );
            await this.precedentStoreService.saveHtmlDetail(detail);
          } else {
            const detail = await this.precedentService.getPrecedent(Number(id));
            await this.precedentStoreService.saveDetail(detail);
          }
          detailsSaved += 1;
        } catch (error) {
          const message = this.getErrorMessage(error);
          detailFailures.push({ target: id, message });
          await this.precedentStoreService.saveDetailError(id, message);
          this.logger.error(`${id} 상세 수집 실패: ${message}`);
        }

        processed += 1;
        if (processed % 25 === 0 || processed === missingDetails.length) {
          this.logger.log(
            `상세 수집 ${processed}/${missingDetails.length}, 저장 ${detailsSaved}건`,
          );
        }
        await this.delay(this.requestDelayMs * this.detailConcurrency);
      }
    };

    await Promise.all(
      Array.from({ length: this.detailConcurrency }, () => worker()),
    );

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      totalPrecedents: ids.length,
      detailsRequested: missingDetails.length,
      detailsSaved,
      detailsSkipped: ids.length - missingDetails.length,
      detailFailures,
    };
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await this.delay(attempt * 1000);
        }
      }
    }

    throw lastError;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
