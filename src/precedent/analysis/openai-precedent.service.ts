import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  LEGAL_ANALYSIS_JSON_SCHEMA,
  LEGAL_ANALYSIS_PROMPT,
} from './precedent-analysis.prompt';
import { mergePrecedentAnalyses } from './precedent-analysis-merge';
import {
  buildPrecedentAnalysisChunk,
  PrecedentAnalysisSource,
} from './precedent-analysis-source';
import {
  COURT_LEVELS,
  EVIDENCE_TEXT_TYPES,
  PrecedentAnalysisIssue,
  PrecedentCourtFinding,
  PrecedentLegalAnalysis,
  PrecedentLegalContext,
} from './precedent-analysis.types';
import { splitPrecedentContent } from './precedent-content';

const EMBEDDING_DIMENSIONS = 1536;

@Injectable()
export class OpenAiPrecedentService {
  private client: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {}

  get analysisModel(): string {
    return this.configService.get<string>(
      'OPENAI_ANALYSIS_MODEL',
      'gpt-5-mini',
    );
  }

  get embeddingModel(): string {
    return this.configService.get<string>(
      'OPENAI_EMBEDDING_MODEL',
      'text-embedding-3-large',
    );
  }

  async analyzePrecedent(
    source: PrecedentAnalysisSource,
  ): Promise<PrecedentLegalAnalysis> {
    const chunks = splitPrecedentContent(source.fullContent);
    const analyses: PrecedentLegalAnalysis[] = [];

    for (const [index, chunk] of chunks.entries()) {
      analyses.push(
        await this.analyzePrecedentChunk(source, chunk, index, chunks.length),
      );
    }

    return mergePrecedentAnalyses(analyses);
  }

  private async analyzePrecedentChunk(
    source: PrecedentAnalysisSource,
    content: string,
    index: number,
    totalChunks: number,
  ): Promise<PrecedentLegalAnalysis> {
    const response = await this.getClient().responses.create({
      model: this.analysisModel,
      instructions: LEGAL_ANALYSIS_PROMPT,
      input: JSON.stringify(
        buildPrecedentAnalysisChunk(source, content, index, totalChunks),
      ),
      max_output_tokens: 12_000,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'precedent_legal_analysis',
          strict: true,
          schema: LEGAL_ANALYSIS_JSON_SCHEMA,
        },
      },
    });

    if (!response.output_text) {
      throw new Error('OpenAI가 판례 분석 결과를 반환하지 않았습니다.');
    }

    return this.parseAnalysis(response.output_text);
  }

  async createEmbeddings(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const response = await this.getClient().embeddings.create({
      model: this.embeddingModel,
      input: inputs,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float',
    });
    const embeddings = [...response.data]
      .sort((left, right) => left.index - right.index)
      .map((item) => Array.from(item.embedding));

    if (
      embeddings.length !== inputs.length ||
      embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)
    ) {
      throw new Error(
        'OpenAI 임베딩 응답의 개수 또는 차원이 올바르지 않습니다.',
      );
    }

    return embeddings;
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.configService.get<string>('SECRET_KEY');

    if (!apiKey) {
      throw new InternalServerErrorException(
        'SECRET_KEY 환경 변수가 설정되지 않았습니다.',
      );
    }

    this.client = new OpenAI({
      apiKey,
      maxRetries: 2,
      timeout: 120_000,
    });
    return this.client;
  }

  private parseAnalysis(output: string): PrecedentLegalAnalysis {
    const value: unknown = JSON.parse(output);
    const root = this.requireRecord(value, 'analysis');

    if (!Array.isArray(root.issues)) {
      throw new Error('issues가 배열이 아닙니다.');
    }

    return {
      issues: (root.issues as unknown[]).map((issue, index) =>
        this.parseIssue(issue, index),
      ),
    };
  }

  private parseIssue(value: unknown, index: number): PrecedentAnalysisIssue {
    const field = `issues[${index}]`;
    const issue = this.requireRecord(value, field);
    const evidenceTexts = this.requireStringArray(
      issue.evidenceTexts,
      `${field}.evidenceTexts`,
    );

    if (evidenceTexts.length === 0) {
      throw new Error(`${field}.evidenceTexts가 비어 있습니다.`);
    }

    if (
      !Array.isArray(issue.courtFindings) ||
      issue.courtFindings.length === 0
    ) {
      throw new Error(`${field}.courtFindings가 비어 있습니다.`);
    }

    return {
      evidenceType: this.requireEnum(
        issue.evidenceType,
        EVIDENCE_TEXT_TYPES,
        `${field}.evidenceType`,
      ),
      evidenceTexts,
      factPattern: this.requireString(
        issue.factPattern,
        `${field}.factPattern`,
      ),
      searchSummary: this.requireString(
        issue.searchSummary,
        `${field}.searchSummary`,
      ),
      legalContext: this.parseLegalContext(
        this.requireRecord(issue.legalContext, `${field}.legalContext`),
        field,
      ),
      crimeTypes: this.requireStringArray(
        issue.crimeTypes,
        `${field}.crimeTypes`,
      ),
      keywords: this.requireStringArray(issue.keywords, `${field}.keywords`),
      courtFindings: (issue.courtFindings as unknown[]).map(
        (finding, findingIndex) =>
          this.parseCourtFinding(finding, index, findingIndex),
      ),
    };
  }

  private parseCourtFinding(
    value: unknown,
    issueIndex: number,
    findingIndex: number,
  ): PrecedentCourtFinding {
    const field = `issues[${issueIndex}].courtFindings[${findingIndex}]`;
    const finding = this.requireRecord(value, field);

    return {
      courtName: this.requireString(finding.courtName, `${field}.courtName`),
      courtLevel: this.requireEnum(
        finding.courtLevel,
        COURT_LEVELS,
        `${field}.courtLevel`,
      ),
      holding: this.requireString(finding.holding, `${field}.holding`),
      evidenceAssessment: this.requireString(
        finding.evidenceAssessment,
        `${field}.evidenceAssessment`,
      ),
      abstractRules: this.requireStringArray(
        finding.abstractRules,
        `${field}.abstractRules`,
      ),
      isGuiltyRecognized: this.requireNullableBoolean(
        finding.isGuiltyRecognized,
        `${field}.isGuiltyRecognized`,
      ),
      evidenceAccepted: this.requireNullableBoolean(
        finding.evidenceAccepted,
        `${field}.evidenceAccepted`,
      ),
      publicityRecognized: this.requireNullableBoolean(
        finding.publicityRecognized,
        `${field}.publicityRecognized`,
      ),
      specificityRecognized: this.requireNullableBoolean(
        finding.specificityRecognized,
        `${field}.specificityRecognized`,
      ),
    };
  }

  private parseLegalContext(
    value: Record<string, unknown>,
    parentField: string,
  ): PrecedentLegalContext {
    return {
      isGroupChat: this.requireNullableBoolean(
        value.isGroupChat,
        `${parentField}.legalContext.isGroupChat`,
      ),
      audienceCount: this.requireNullableInteger(
        value.audienceCount,
        `${parentField}.legalContext.audienceCount`,
      ),
      victimIdentifiable: this.requireNullableBoolean(
        value.victimIdentifiable,
        `${parentField}.legalContext.victimIdentifiable`,
      ),
    };
  }

  private requireEnum<T extends string>(
    value: unknown,
    allowedValues: readonly T[],
    field: string,
  ): T {
    if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
      throw new Error(`${field} 값이 지원되지 않습니다.`);
    }

    return value as T;
  }

  private requireRecord(
    value: unknown,
    field: string,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${field}가 객체가 아닙니다.`);
    }

    return value as Record<string, unknown>;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new Error(`${field}가 문자열이 아닙니다.`);
    }

    return value.trim();
  }

  private requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) {
      throw new Error(`${field}가 문자열 배열이 아닙니다.`);
    }

    const strings: string[] = [];

    for (const item of value as unknown[]) {
      if (typeof item !== 'string') {
        throw new Error(`${field}가 문자열 배열이 아닙니다.`);
      }
      const normalized = item.trim();
      if (normalized) {
        strings.push(normalized);
      }
    }

    return [...new Set(strings)];
  }

  private requireNullableBoolean(
    value: unknown,
    field: string,
  ): boolean | null {
    if (value !== null && typeof value !== 'boolean') {
      throw new Error(`${field}가 불리언 또는 null이 아닙니다.`);
    }

    return value;
  }

  private requireNullableInteger(value: unknown, field: string): number | null {
    if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) {
      throw new Error(`${field}가 0 이상의 정수 또는 null이 아닙니다.`);
    }

    return value as number | null;
  }
}
