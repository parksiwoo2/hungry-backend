import type {
  EvidenceTextType,
  PrecedentCourtFinding,
  PrecedentLegalContext,
} from '../analysis/precedent-analysis.types';

export const PRECEDENT_SEARCH_MODES = [
  'hybrid',
  'summary',
  'fact',
  'rule',
] as const;

export type PrecedentSearchMode = (typeof PRECEDENT_SEARCH_MODES)[number];

export interface PrecedentHybridSearchFilters {
  caseNumber?: string;
  crimeTypes?: string[];
  keywords?: string[];
}

export interface PrecedentHybridSearchRequest {
  query: string;
  mode: PrecedentSearchMode;
  limit: number;
  offset: number;
  filters: PrecedentHybridSearchFilters;
}

export interface PrecedentHybridSearchScore {
  overall: number;
  vector: number;
  summary: number;
  fact: number;
  rule: number;
  keyword: number;
  exactCaseNumber: number;
}

export interface PrecedentHybridSearchResult {
  precedentId: string;
  issueId: string;
  issueOrder: number;
  caseNumber: string | null;
  caseName: string | null;
  courtName: string | null;
  judgementDate: string | null;
  searchSummary: string;
  evidenceType: EvidenceTextType;
  evidenceTexts: string[];
  factPattern: string;
  legalContext: PrecedentLegalContext;
  crimeTypes: string[];
  keywords: string[];
  courtFindings: PrecedentCourtFinding[];
  score: PrecedentHybridSearchScore;
}

export interface PrecedentHybridSearchResponse {
  query: string;
  mode: PrecedentSearchMode;
  filters: PrecedentHybridSearchFilters;
  results: PrecedentHybridSearchResult[];
}
