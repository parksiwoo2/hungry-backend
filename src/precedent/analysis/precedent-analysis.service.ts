import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OpenAiPrecedentService } from './openai-precedent.service';
import { keepGroundedTextIssues } from './precedent-analysis-grounding';
import { PrecedentAnalysisIssueEntity } from '../entities/precedent-analysis-issue.entity';
import { PrecedentAnalysisEntity } from '../entities/precedent-analysis.entity';
import {
  buildPrecedentAnalysisSource,
  PrecedentAnalysisSource,
} from './precedent-analysis-source';
import { LEGAL_ANALYSIS_PROMPT_VERSION } from './precedent-analysis.prompt';
import { PrecedentLegalAnalysis } from './precedent-analysis.types';
import {
  preparePrecedentContent,
  splitPrecedentContent,
} from './precedent-content';
import {
  buildFactEmbeddingText,
  buildRuleEmbeddingText,
  buildSummaryEmbeddingText,
} from './precedent-embedding-text';
import { PrecedentIssueEmbeddingEntity } from '../entities/precedent-issue-embedding.entity';
import { PrecedentIssueFindingEntity } from '../entities/precedent-issue-finding.entity';
import { PrecedentSearchDocumentEntity } from '../entities/precedent-search-document.entity';
import {
  buildPrecedentSearchText,
  collectIssueCrimeTypes,
  collectIssueKeywords,
} from './precedent-search-text';
import { PrecedentEntity } from '../entities/precedent.entity';

export interface AnalyzePrecedentsOptions {
  limit?: number;
  concurrency?: number;
  retryErrors?: boolean;
}

export interface AnalyzePrecedentsSummary {
  totalPrecedents: number;
  eligiblePrecedents: number;
  requestedPrecedents: number;
  analyzedPrecedents: number;
  extractedIssues: number;
  noTextIssuePrecedents: number;
  skippedExisting: number;
  skippedInvalidContent: number;
  failedPrecedents: number;
}

interface AnalysisCandidate {
  precedentId: string;
  source: PrecedentAnalysisSource;
  sourceContentHash: string;
}

interface CompletedAnalysis {
  candidate: AnalysisCandidate;
  analysis: PrecedentLegalAnalysis;
}

interface IssueEmbeddingSet {
  summaryText: string;
  factText: string;
  ruleText: string;
  summaryEmbedding: number[];
  factEmbedding: number[];
  ruleEmbedding: number[];
}

@Injectable()
export class PrecedentAnalysisService {
  private readonly logger = new Logger(PrecedentAnalysisService.name);
  private readonly precedentBatchSize = 100;

  constructor(
    @InjectRepository(PrecedentEntity)
    private readonly precedentRepository: Repository<PrecedentEntity>,
    @InjectRepository(PrecedentAnalysisEntity)
    private readonly analysisRepository: Repository<PrecedentAnalysisEntity>,
    private readonly dataSource: DataSource,
    private readonly openAiService: OpenAiPrecedentService,
  ) {}

  async analyzeAll(
    options: AnalyzePrecedentsOptions = {},
  ): Promise<AnalyzePrecedentsSummary> {
    const concurrency = Math.min(20, Math.max(1, options.concurrency ?? 2));
    const limit = options.limit
      ? Math.max(1, Math.floor(options.limit))
      : Number.POSITIVE_INFINITY;
    const precedents = await this.precedentRepository
      .createQueryBuilder('precedent')
      .addSelect('precedent.rawDetailHtml')
      .orderBy('precedent.externalId', 'ASC')
      .getMany();
    const existingAnalyses = await this.analysisRepository.find();
    const existingById = new Map(
      existingAnalyses.map((analysis) => [analysis.precedentId, analysis]),
    );
    const candidates: AnalysisCandidate[] = [];
    let skippedExisting = 0;
    let skippedInvalidContent = 0;

    for (const precedent of precedents) {
      const preparation = preparePrecedentContent(precedent.fullContent);
      const existing = existingById.get(precedent.externalId);

      if (preparation.status !== 'found' || !preparation.content) {
        const sourceContentHash = this.hash(precedent.fullContent ?? '');
        if (
          !existing ||
          existing.status !== 'skipped' ||
          existing.sourceContentHash !== sourceContentHash
        ) {
          await this.saveStatus(
            precedent.externalId,
            sourceContentHash,
            'skipped',
            preparation.status,
          );
        }
        skippedInvalidContent += 1;
        continue;
      }

      const source = buildPrecedentAnalysisSource(
        precedent,
        preparation.content,
      );
      const sourceContentHash = this.hash(JSON.stringify(source));

      if (this.canSkipExisting(existing, sourceContentHash, options)) {
        skippedExisting += 1;
        continue;
      }

      if (candidates.length < limit) {
        candidates.push({
          precedentId: precedent.externalId,
          source,
          sourceContentHash,
        });
      }
    }

    let analyzedPrecedents = 0;
    let extractedIssues = 0;
    let noTextIssuePrecedents = 0;
    let failedPrecedents = 0;

    for (
      let offset = 0;
      offset < candidates.length;
      offset += this.precedentBatchSize
    ) {
      const batch = candidates.slice(offset, offset + this.precedentBatchSize);
      const analyzed = await this.analyzeBatch(batch, concurrency);
      failedPrecedents += batch.length - analyzed.length;

      for (const result of analyzed) {
        try {
          const embeddingSets = await this.createIssueEmbeddingSets(
            result.analysis.issues,
          );
          await this.saveCompletedAnalysis(result, embeddingSets);
          analyzedPrecedents += 1;
          extractedIssues += result.analysis.issues.length;
          if (result.analysis.issues.length === 0) {
            noTextIssuePrecedents += 1;
          }
        } catch (error) {
          failedPrecedents += 1;
          await this.saveStatus(
            result.candidate.precedentId,
            result.candidate.sourceContentHash,
            'error',
            this.getErrorMessage(error),
          );
        }
      }

      this.logger.log(
        `판례 AI 분석 ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}, 완료 ${analyzedPrecedents}건, 쟁점 ${extractedIssues}건, 실패 ${failedPrecedents}건`,
      );
    }

    return {
      totalPrecedents: precedents.length,
      eligiblePrecedents: precedents.length - skippedInvalidContent,
      requestedPrecedents: candidates.length,
      analyzedPrecedents,
      extractedIssues,
      noTextIssuePrecedents,
      skippedExisting,
      skippedInvalidContent,
      failedPrecedents,
    };
  }

  private async analyzeBatch(
    candidates: AnalysisCandidate[],
    concurrency: number,
  ): Promise<CompletedAnalysis[]> {
    const results: Array<CompletedAnalysis | null> = Array.from(
      { length: candidates.length },
      (): CompletedAnalysis | null => null,
    );
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        const candidate = candidates[index];

        await this.saveStatus(
          candidate.precedentId,
          candidate.sourceContentHash,
          'processing',
          null,
        );

        try {
          const analysis = await this.openAiService.analyzePrecedent(
            candidate.source,
          );
          results[index] = {
            candidate,
            analysis: keepGroundedTextIssues(
              analysis,
              candidate.source.fullContent,
            ),
          };
        } catch (error) {
          await this.saveStatus(
            candidate.precedentId,
            candidate.sourceContentHash,
            'error',
            this.getErrorMessage(error),
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, candidates.length) }, () =>
        worker(),
      ),
    );
    return results.filter((result): result is CompletedAnalysis => !!result);
  }

  private async saveCompletedAnalysis(
    result: CompletedAnalysis,
    embeddingSets: IssueEmbeddingSet[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const analysisRepository = manager.getRepository(PrecedentAnalysisEntity);
      const issueRepository = manager.getRepository(
        PrecedentAnalysisIssueEntity,
      );
      const findingRepository = manager.getRepository(
        PrecedentIssueFindingEntity,
      );
      const embeddingRepository = manager.getRepository(
        PrecedentIssueEmbeddingEntity,
      );
      const searchDocumentRepository = manager.getRepository(
        PrecedentSearchDocumentEntity,
      );
      const existing = await analysisRepository.findOneBy({
        precedentId: result.candidate.precedentId,
      });
      const analysisEntity =
        existing ??
        analysisRepository.create({
          precedentId: result.candidate.precedentId,
        });

      analysisEntity.status = 'complete';
      analysisEntity.sourceContentHash = result.candidate.sourceContentHash;
      analysisEntity.promptVersion = LEGAL_ANALYSIS_PROMPT_VERSION;
      analysisEntity.analysisModel = this.openAiService.analysisModel;
      analysisEntity.embeddingModel = this.openAiService.embeddingModel;
      analysisEntity.issueCount = result.analysis.issues.length;
      analysisEntity.error = null;
      analysisEntity.analyzedAt = new Date();
      await analysisRepository.save(analysisEntity);
      await issueRepository.delete({
        precedentId: result.candidate.precedentId,
      });

      for (const [issueIndex, issue] of result.analysis.issues.entries()) {
        const issueId = randomUUID();
        const embeddingSet = embeddingSets[issueIndex];
        await issueRepository.save(
          issueRepository.create({
            id: issueId,
            precedentId: result.candidate.precedentId,
            issueOrder: issueIndex + 1,
            evidenceType: issue.evidenceType,
            evidenceTexts: issue.evidenceTexts,
            factPattern: issue.factPattern,
            searchSummary: issue.searchSummary,
            isGroupChat: issue.legalContext.isGroupChat,
            audienceCount: issue.legalContext.audienceCount,
            victimIdentifiable: issue.legalContext.victimIdentifiable,
            crimeTypes: issue.crimeTypes,
            keywords: issue.keywords,
          }),
        );
        await findingRepository.save(
          issue.courtFindings.map((finding, findingIndex) =>
            findingRepository.create({
              id: randomUUID(),
              issueId,
              findingOrder: findingIndex + 1,
              courtName: finding.courtName,
              courtLevel: finding.courtLevel,
              holding: finding.holding,
              evidenceAssessment: finding.evidenceAssessment,
              abstractRules: finding.abstractRules,
              isGuiltyRecognized: finding.isGuiltyRecognized,
              evidenceAccepted: finding.evidenceAccepted,
              publicityRecognized: finding.publicityRecognized,
              specificityRecognized: finding.specificityRecognized,
            }),
          ),
        );
        await embeddingRepository.save(
          embeddingRepository.create({
            issueId,
            embeddingModel: this.openAiService.embeddingModel,
            summaryContentHash: this.hash(embeddingSet.summaryText),
            factContentHash: this.hash(embeddingSet.factText),
            ruleContentHash: this.hash(embeddingSet.ruleText),
            summaryEmbedding: embeddingSet.summaryEmbedding,
            factEmbedding: embeddingSet.factEmbedding,
            ruleEmbedding: embeddingSet.ruleEmbedding,
          }),
        );
      }

      const searchText = buildPrecedentSearchText(
        result.candidate.source,
        result.analysis.issues,
      );
      const crimeTypes = collectIssueCrimeTypes(result.analysis.issues);
      const keywords = collectIssueKeywords(result.analysis.issues);
      const searchTextChunks = splitPrecedentContent(searchText, 80_000, 0);
      await searchDocumentRepository.delete({
        precedentId: result.candidate.precedentId,
      });
      await searchDocumentRepository.save(
        searchTextChunks.map((chunk, index) =>
          searchDocumentRepository.create({
            precedentId: result.candidate.precedentId,
            chunkOrder: index + 1,
            searchText: chunk,
            crimeTypes,
            keywords,
          }),
        ),
      );
    });
  }

  private async createIssueEmbeddingSets(
    issues: PrecedentLegalAnalysis['issues'],
  ): Promise<IssueEmbeddingSet[]> {
    const texts = issues.map((issue) => ({
      summaryText: buildSummaryEmbeddingText(issue),
      factText: buildFactEmbeddingText(issue),
      ruleText: buildRuleEmbeddingText(issue),
    }));
    const embeddings = await this.openAiService.createEmbeddings(
      texts.flatMap(({ summaryText, factText, ruleText }) => [
        summaryText,
        factText,
        ruleText,
      ]),
    );

    return texts.map((text, index) => ({
      ...text,
      summaryEmbedding: embeddings[index * 3],
      factEmbedding: embeddings[index * 3 + 1],
      ruleEmbedding: embeddings[index * 3 + 2],
    }));
  }

  private async saveStatus(
    precedentId: string,
    sourceContentHash: string,
    status: string,
    error: string | null,
  ): Promise<void> {
    const existing = await this.analysisRepository.findOneBy({ precedentId });
    const entity =
      existing ??
      this.analysisRepository.create({ precedentId, issueCount: 0 });

    entity.status = status;
    entity.sourceContentHash = sourceContentHash;
    entity.promptVersion = LEGAL_ANALYSIS_PROMPT_VERSION;
    entity.analysisModel = this.openAiService.analysisModel;
    entity.embeddingModel = this.openAiService.embeddingModel;
    entity.error = error;

    if (status !== 'complete') {
      entity.analyzedAt = null;
    }

    await this.analysisRepository.save(entity);
  }

  private canSkipExisting(
    existing: PrecedentAnalysisEntity | undefined,
    sourceContentHash: string,
    options: AnalyzePrecedentsOptions,
  ): boolean {
    if (!existing || existing.sourceContentHash !== sourceContentHash) {
      return false;
    }

    if (
      existing.promptVersion !== LEGAL_ANALYSIS_PROMPT_VERSION ||
      existing.analysisModel !== this.openAiService.analysisModel ||
      existing.embeddingModel !== this.openAiService.embeddingModel
    ) {
      return false;
    }

    if (existing.status === 'complete') {
      return true;
    }

    return existing.status === 'error' && !options.retryErrors;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private getErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 4_000);
  }
}
