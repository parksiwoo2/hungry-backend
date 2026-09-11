import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrecedentAnalysisIssueEntity } from '../entities/precedent-analysis-issue.entity';
import { PrecedentAnalysisEntity } from '../entities/precedent-analysis.entity';
import { PrecedentIssueEmbeddingEntity } from '../entities/precedent-issue-embedding.entity';
import { PrecedentIssueFindingEntity } from '../entities/precedent-issue-finding.entity';
import { PrecedentSearchDocumentEntity } from '../entities/precedent-search-document.entity';
import { PrecedentEntity } from '../entities/precedent.entity';
import { OpenAiPrecedentService } from './openai-precedent.service';
import { PrecedentAnalysisService } from './precedent-analysis.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrecedentEntity,
      PrecedentAnalysisEntity,
      PrecedentAnalysisIssueEntity,
      PrecedentIssueFindingEntity,
      PrecedentIssueEmbeddingEntity,
      PrecedentSearchDocumentEntity,
    ]),
  ],
  providers: [OpenAiPrecedentService, PrecedentAnalysisService],
  exports: [OpenAiPrecedentService, PrecedentAnalysisService],
})
export class PrecedentAnalysisModule {}
