import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OpenAiPrecedentService } from '../analysis/openai-precedent.service';
import type {
  EvidenceTextType,
  PrecedentCourtFinding,
} from '../analysis/precedent-analysis.types';
import {
  PRECEDENT_SEARCH_MODES,
  PrecedentHybridSearchRequest,
  PrecedentHybridSearchResponse,
  PrecedentHybridSearchResult,
  PrecedentSearchMode,
} from './precedent-hybrid-search.types';
import {
  buildPrecedentTsQuery,
  extractPrecedentSearchTerms,
} from './precedent-search-terms';

interface HybridSearchRow {
  precedent_id: string;
  issue_id: string;
  issue_order: number;
  case_number: string | null;
  case_name: string | null;
  court_name: string | null;
  judgement_date: string | null;
  search_summary: string;
  evidence_type: EvidenceTextType;
  evidence_texts: string[];
  fact_pattern: string;
  is_group_chat: boolean | null;
  audience_count: number | null;
  victim_identifiable: boolean | null;
  crime_types: string[];
  keywords: string[];
  court_findings: PrecedentCourtFinding[] | string;
  summary_score: number | string;
  fact_score: number | string;
  rule_score: number | string;
  vector_score: number | string;
  keyword_score: number | string;
  exact_case_score: number | string;
  overall_score: number | string;
}

@Injectable()
export class PrecedentHybridSearchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly openAiService: OpenAiPrecedentService,
  ) {}

  async search(body: unknown): Promise<PrecedentHybridSearchResponse> {
    const request = this.validateRequest(body);
    const [embedding] = await this.openAiService.createEmbeddings([
      request.query,
    ]);
    const results = await this.searchDatabase(request, embedding);

    return {
      query: request.query,
      mode: request.mode,
      filters: request.filters,
      results,
    };
  }

  private async searchDatabase(
    request: PrecedentHybridSearchRequest,
    embedding: number[],
  ): Promise<PrecedentHybridSearchResult[]> {
    const vector = `[${embedding.join(',')}]`;
    const searchTerms = extractPrecedentSearchTerms(request.query);
    const keywordTsQuery = buildPrecedentTsQuery(searchTerms);
    const rows = await this.dataSource.query<HybridSearchRow[]>(
      `
        WITH query_data AS (
          SELECT
            $1::vector AS embedding,
            websearch_to_tsquery('simple'::regconfig, $2) AS natural_text_query,
            to_tsquery('simple'::regconfig, $9) AS keyword_text_query
        ), fts_scores AS (
          SELECT
            psd.precedent_id,
            MAX(
              LEAST(
                1,
                GREATEST(
                  ts_rank_cd(psd.fts_vector, q.natural_text_query) * 5,
                  ts_rank_cd(psd.fts_vector, q.keyword_text_query) * 4
                )
              )
            ) AS fts_score
          FROM precedent_search_documents psd
          CROSS JOIN query_data q
          WHERE (
              numnode(q.natural_text_query) > 0
              AND psd.fts_vector @@ q.natural_text_query
            ) OR (
              numnode(q.keyword_text_query) > 0
              AND psd.fts_vector @@ q.keyword_text_query
            )
          GROUP BY psd.precedent_id
        ), finding_data AS (
          SELECT
            issue_id,
            jsonb_agg(
              jsonb_build_object(
                'courtName', court_name,
                'courtLevel', court_level,
                'holding', holding,
                'evidenceAssessment', evidence_assessment,
                'abstractRules', abstract_rules,
                'isGuiltyRecognized', is_guilty_recognized,
                'evidenceAccepted', evidence_accepted,
                'publicityRecognized', publicity_recognized,
                'specificityRecognized', specificity_recognized
              ) ORDER BY finding_order
            ) AS court_findings
          FROM precedent_issue_findings
          GROUP BY issue_id
        ), base_scores AS (
          SELECT
            pai.precedent_id,
            pai.id AS issue_id,
            pai.issue_order,
            p.case_number,
            p.case_name,
            p.court_name,
            p.judgement_date,
            pai.search_summary,
            pai.evidence_type,
            pai.evidence_texts,
            pai.fact_pattern,
            pai.is_group_chat,
            pai.audience_count,
            pai.victim_identifiable,
            pai.crime_types,
            pai.keywords,
            fd.court_findings,
            GREATEST(0, 1 - (pie.summary_embedding <=> q.embedding)) AS summary_score,
            GREATEST(0, 1 - (pie.fact_embedding <=> q.embedding)) AS fact_score,
            GREATEST(0, 1 - (pie.rule_embedding <=> q.embedding)) AS rule_score,
            GREATEST(
              coalesce(fs.fts_score, 0),
              CASE WHEN pai.keywords && $10::text[] THEN 1.0 ELSE 0.0 END
            ) AS keyword_score,
            CASE
              WHEN p.case_number = $2
              THEN 1.0
              ELSE 0.0
            END AS exact_case_score
          FROM precedent_issue_embeddings pie
          INNER JOIN precedent_analysis_issues pai ON pai.id = pie.issue_id
          INNER JOIN precedent_analyses pa ON pa.precedent_id = pai.precedent_id
          LEFT JOIN fts_scores fs ON fs.precedent_id = pai.precedent_id
          INNER JOIN precedents p ON p.external_id = pai.precedent_id
          INNER JOIN finding_data fd ON fd.issue_id = pai.id
          CROSS JOIN query_data q
          WHERE pa.status = 'complete'
            AND (
              $4::text IS NULL OR p.case_number = $4
            )
            AND (
              $5::text[] IS NULL OR pai.crime_types && $5::text[]
            )
            AND (
              $6::text[] IS NULL OR pai.keywords && $6::text[]
            )
        ), vector_scores AS (
          SELECT
            base_scores.*,
            CASE $3
              WHEN 'summary' THEN summary_score
              WHEN 'fact' THEN fact_score
              WHEN 'rule' THEN rule_score
              ELSE summary_score * 0.5 + fact_score * 0.3 + rule_score * 0.2
            END AS vector_score
          FROM base_scores
        ), final_scores AS (
          SELECT
            vector_scores.*,
            LEAST(
              1,
              vector_score * 0.7 + keyword_score * 0.2 + exact_case_score * 0.3
            ) AS overall_score
          FROM vector_scores
        ), distinct_precedents AS (
          SELECT
            final_scores.*,
            ROW_NUMBER() OVER (
              PARTITION BY precedent_id
              ORDER BY overall_score DESC, vector_score DESC, issue_order ASC
            ) AS precedent_rank
          FROM final_scores
        )
        SELECT *
        FROM distinct_precedents
        WHERE precedent_rank = 1
        ORDER BY overall_score DESC, vector_score DESC, precedent_id ASC
        LIMIT $7
        OFFSET $8
      `,
      [
        vector,
        request.query,
        request.mode,
        request.filters.caseNumber ?? null,
        request.filters.crimeTypes?.length ? request.filters.crimeTypes : null,
        request.filters.keywords?.length ? request.filters.keywords : null,
        request.limit,
        request.offset,
        keywordTsQuery,
        searchTerms,
      ],
    );

    return rows.map((row) => ({
      precedentId: row.precedent_id,
      issueId: row.issue_id,
      issueOrder: row.issue_order,
      caseNumber: row.case_number,
      caseName: row.case_name,
      courtName: row.court_name,
      judgementDate: row.judgement_date,
      searchSummary: row.search_summary,
      evidenceType: row.evidence_type,
      evidenceTexts: row.evidence_texts,
      factPattern: row.fact_pattern,
      legalContext: {
        isGroupChat: row.is_group_chat,
        audienceCount: row.audience_count,
        victimIdentifiable: row.victim_identifiable,
      },
      crimeTypes: row.crime_types,
      keywords: row.keywords,
      courtFindings: this.parseCourtFindings(row.court_findings),
      score: {
        overall: this.roundScore(row.overall_score),
        vector: this.roundScore(row.vector_score),
        summary: this.roundScore(row.summary_score),
        fact: this.roundScore(row.fact_score),
        rule: this.roundScore(row.rule_score),
        keyword: this.roundScore(row.keyword_score),
        exactCaseNumber: this.roundScore(row.exact_case_score),
      },
    }));
  }

  private validateRequest(body: unknown): PrecedentHybridSearchRequest {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('요청 본문은 객체여야 합니다.');
    }

    const value = body as Record<string, unknown>;
    const query = value.query;
    const mode = value.mode ?? 'hybrid';
    const limit = value.limit ?? 10;
    const offset = value.offset ?? 0;

    if (
      typeof query !== 'string' ||
      query.trim().length < 1 ||
      query.length > 5_000
    ) {
      throw new BadRequestException(
        'query는 1자부터 5000자까지 입력해야 합니다.',
      );
    }

    if (
      typeof mode !== 'string' ||
      !PRECEDENT_SEARCH_MODES.includes(mode as PrecedentSearchMode)
    ) {
      throw new BadRequestException(
        `mode는 ${PRECEDENT_SEARCH_MODES.join(', ')} 중 하나여야 합니다.`,
      );
    }

    if (
      !Number.isInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > 20
    ) {
      throw new BadRequestException('limit은 1부터 20까지의 정수여야 합니다.');
    }

    if (!Number.isInteger(offset) || (offset as number) < 0) {
      throw new BadRequestException('offset은 0 이상의 정수여야 합니다.');
    }

    return {
      query: query.trim(),
      mode: mode as PrecedentSearchMode,
      limit: limit as number,
      offset: offset as number,
      filters: this.validateFilters(value.filters),
    };
  }

  private validateFilters(
    value: unknown,
  ): PrecedentHybridSearchRequest['filters'] {
    if (value === undefined) {
      return {};
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('filters는 객체여야 합니다.');
    }

    const filters = value as Record<string, unknown>;
    return {
      caseNumber: this.validateOptionalString(filters.caseNumber, 'caseNumber'),
      crimeTypes: this.validateOptionalStringArray(
        filters.crimeTypes,
        'crimeTypes',
      ),
      keywords: this.validateOptionalStringArray(filters.keywords, 'keywords'),
    };
  }

  private validateOptionalString(
    value: unknown,
    field: string,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new BadRequestException(`${field} 형식이 올바르지 않습니다.`);
    }

    return value.trim();
  }

  private validateOptionalStringArray(
    value: unknown,
    field: string,
  ): string[] | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Array.isArray(value) || value.length > 20) {
      throw new BadRequestException(
        `${field}는 최대 20개의 문자열 배열입니다.`,
      );
    }

    const strings = value.map((item) => {
      if (typeof item !== 'string' || !item.trim() || item.length > 100) {
        throw new BadRequestException(`${field} 형식이 올바르지 않습니다.`);
      }
      return item.trim();
    });

    return [...new Set(strings)];
  }

  private parseCourtFindings(
    value: PrecedentCourtFinding[] | string,
  ): PrecedentCourtFinding[] {
    return typeof value === 'string'
      ? (JSON.parse(value) as PrecedentCourtFinding[])
      : value;
  }

  private roundScore(value: number | string): number {
    return Number(Number(value).toFixed(6));
  }
}
