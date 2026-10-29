import type { PrecedentEntity } from '../entities/precedent.entity';

export interface PrecedentAnalysisSource {
  externalId: string;
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
  fullContent: string;
  matchedCategories: string[];
  matchedQueries: string[];
  rawDetailHtml: string | null;
  detailStatus: string;
  detailError: string | null;
  detailFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function buildPrecedentAnalysisSource(
  precedent: PrecedentEntity,
  fullContent: string,
): PrecedentAnalysisSource {
  return {
    externalId: precedent.externalId,
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
    fullContent,
    matchedCategories: precedent.matchedCategories,
    matchedQueries: precedent.matchedQueries,
    rawDetailHtml: precedent.rawDetailHtml,
    detailStatus: precedent.detailStatus,
    detailError: precedent.detailError,
    detailFetchedAt: formatDate(precedent.detailFetchedAt),
    createdAt: precedent.createdAt.toISOString(),
    updatedAt: precedent.updatedAt.toISOString(),
  };
}

export function buildPrecedentAnalysisChunk(
  source: PrecedentAnalysisSource,
  fullContent: string,
  chunkIndex: number,
  totalChunks: number,
): Record<string, unknown> {
  return {
    ...source,
    fullContent,
    fullContentChunk: {
      index: chunkIndex + 1,
      total: totalChunks,
    },
  };
}

function formatDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
