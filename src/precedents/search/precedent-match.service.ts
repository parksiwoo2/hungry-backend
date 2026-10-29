import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OpenAiPrecedentService } from '../analysis/openai-precedent.service';
import {
  EvidenceTextType,
  PrecedentAnalysisTarget,
  PrecedentCourtFinding,
  PrecedentMatch,
  PrecedentMatchRequest,
  PrecedentTargetMatchResult,
} from '../analysis/precedent-analysis.types';
import { buildTargetEmbeddingText } from '../analysis/precedent-embedding-text';

interface MatchRow {
  precedent_id: string;
  issue_id: string;
  issue_order: number;
  case_number: string | null;
  case_name: string | null;
  court_name: string | null;
  judgement_date: string | null;
  evidence_type: EvidenceTextType;
  evidence_texts: string[];
  fact_pattern: string;
  search_summary: string;
  is_group_chat: boolean | null;
  audience_count: number | null;
  victim_identifiable: boolean | null;
  crime_types: string[];
  keywords: string[];
  court_findings: PrecedentCourtFinding[] | string;
  semantic_score: number | string;
  context_score: number | string;
  decision_usefulness_score: number | string;
  overall_score: number | string;
}

@Injectable()
export class PrecedentMatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly openAiService: OpenAiPrecedentService,
  ) {}

  async findMatches(body: unknown): Promise<{
    retrievalOnly: true;
    analysisTargets: PrecedentTargetMatchResult[];
  }> {
    const request = this.validateRequest(body);
    const embeddings = await this.openAiService.createEmbeddings(
      request.analysisTargets.map(buildTargetEmbeddingText),
    );
    const analysisTargets = await Promise.all(
      request.analysisTargets.map(async (target, index) => ({
        targetText: target.targetText,
        legalContext: target.legalContext,
        matches: await this.searchOne(target, embeddings[index]),
      })),
    );

    return { retrievalOnly: true, analysisTargets };
  }

  private async searchOne(
    target: PrecedentAnalysisTarget,
    embedding: number[],
  ): Promise<PrecedentMatch[]> {
    const vector = `[${embedding.join(',')}]`;
    const rows = await this.dataSource.query<MatchRow[]>(
      `
        WITH finding_data AS (
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
            ) AS court_findings,
            MAX(CASE WHEN evidence_accepted IS NULL THEN 0 ELSE 1 END) AS has_evidence_decision,
            MAX(CASE WHEN publicity_recognized IS NULL THEN 0 ELSE 1 END) AS has_publicity_decision,
            MAX(CASE WHEN specificity_recognized IS NULL THEN 0 ELSE 1 END) AS has_specificity_decision
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
            pai.evidence_type,
            pai.evidence_texts,
            pai.fact_pattern,
            pai.search_summary,
            pai.is_group_chat,
            pai.audience_count,
            pai.victim_identifiable,
            pai.crime_types,
            pai.keywords,
            fd.court_findings,
            GREATEST(0, 1 - (pie.fact_embedding <=> $1::vector)) AS semantic_score,
            CASE
              WHEN pai.is_group_chat IS NULL THEN 0.5
              WHEN pai.is_group_chat = $2 THEN 1.0
              ELSE 0.0
            END AS group_chat_score,
            CASE
              WHEN pai.victim_identifiable IS NULL THEN 0.5
              WHEN pai.victim_identifiable = $3 THEN 1.0
              ELSE 0.0
            END AS victim_score,
            CASE
              WHEN pai.audience_count IS NULL THEN 0.5
              ELSE GREATEST(
                0,
                1 - ABS(pai.audience_count - $4)::double precision /
                  GREATEST($4, 1)::double precision
              )
            END AS audience_score,
            (
              fd.has_evidence_decision * 0.5 +
              fd.has_publicity_decision * 0.25 +
              fd.has_specificity_decision * 0.25
            ) AS decision_usefulness_score
          FROM precedent_issue_embeddings pie
          INNER JOIN precedent_analysis_issues pai ON pai.id = pie.issue_id
          INNER JOIN precedent_analyses pa ON pa.precedent_id = pai.precedent_id
          INNER JOIN precedents p ON p.external_id = pai.precedent_id
          INNER JOIN finding_data fd ON fd.issue_id = pai.id
          WHERE pa.status = 'complete'
        ), context_scores AS (
          SELECT
            base_scores.*,
            (
              group_chat_score * 0.4 +
              victim_score * 0.4 +
              audience_score * 0.2
            ) AS context_score
          FROM base_scores
        ), ranked AS (
          SELECT
            context_scores.*,
            (
              semantic_score * 0.65 +
              context_score * 0.25 +
              decision_usefulness_score * 0.1
            ) AS overall_score
          FROM context_scores
        ), distinct_precedents AS (
          SELECT
            ranked.*,
            ROW_NUMBER() OVER (
              PARTITION BY precedent_id
              ORDER BY overall_score DESC, semantic_score DESC, issue_order ASC
            ) AS precedent_rank
          FROM ranked
        )
        SELECT *
        FROM distinct_precedents
        WHERE precedent_rank = 1
        ORDER BY overall_score DESC, semantic_score DESC
        LIMIT 3
      `,
      [
        vector,
        target.legalContext.isGroupChat,
        target.legalContext.victimIdentifiable,
        target.legalContext.audienceCount,
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
      evidenceType: row.evidence_type,
      evidenceTexts: row.evidence_texts,
      factPattern: row.fact_pattern,
      searchSummary: row.search_summary,
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
        semantic: this.roundScore(row.semantic_score),
        context: this.roundScore(row.context_score),
        decisionUsefulness: this.roundScore(row.decision_usefulness_score),
      },
    }));
  }

  private validateRequest(body: unknown): PrecedentMatchRequest {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('요청 본문은 객체여야 합니다.');
    }

    const analysisTargets = (body as Record<string, unknown>).analysisTargets;

    if (
      !Array.isArray(analysisTargets) ||
      analysisTargets.length < 1 ||
      analysisTargets.length > 10
    ) {
      throw new BadRequestException(
        'analysisTargets는 1개부터 10개까지 입력해야 합니다.',
      );
    }

    return {
      analysisTargets: analysisTargets.map((target, index) =>
        this.validateTarget(target, index),
      ),
    };
  }

  private validateTarget(
    value: unknown,
    index: number,
  ): PrecedentAnalysisTarget {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(
        `analysisTargets[${index}]는 객체여야 합니다.`,
      );
    }

    const target = value as Record<string, unknown>;
    const targetText = target.targetText;
    const legalContext = target.legalContext;

    if (
      typeof targetText !== 'string' ||
      targetText.trim().length < 1 ||
      targetText.length > 5_000
    ) {
      throw new BadRequestException(
        `analysisTargets[${index}].targetText는 1자부터 5000자까지 입력해야 합니다.`,
      );
    }

    if (
      !legalContext ||
      typeof legalContext !== 'object' ||
      Array.isArray(legalContext)
    ) {
      throw new BadRequestException(
        `analysisTargets[${index}].legalContext가 필요합니다.`,
      );
    }

    const context = legalContext as Record<string, unknown>;

    if (
      typeof context.isGroupChat !== 'boolean' ||
      typeof context.victimIdentifiable !== 'boolean' ||
      !Number.isInteger(context.audienceCount) ||
      (context.audienceCount as number) < 0 ||
      (context.audienceCount as number) > 100_000
    ) {
      throw new BadRequestException(
        `analysisTargets[${index}].legalContext 형식이 올바르지 않습니다.`,
      );
    }

    return {
      targetText: targetText.trim(),
      legalContext: {
        isGroupChat: context.isGroupChat,
        audienceCount: context.audienceCount as number,
        victimIdentifiable: context.victimIdentifiable,
      },
    };
  }

  private parseCourtFindings(
    value: PrecedentCourtFinding[] | string,
  ): PrecedentCourtFinding[] {
    if (typeof value === 'string') {
      return JSON.parse(value) as PrecedentCourtFinding[];
    }

    return value;
  }

  private roundScore(value: number | string): number {
    return Number(Number(value).toFixed(6));
  }
}
