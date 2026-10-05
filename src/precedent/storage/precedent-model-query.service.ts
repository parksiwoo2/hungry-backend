import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { DataSource } from 'typeorm';
import { PrecedentAnalysisIssueEntity } from '../entities/precedent-analysis-issue.entity';
import { PrecedentAnalysisEntity } from '../entities/precedent-analysis.entity';
import { PrecedentIssueEmbeddingEntity } from '../entities/precedent-issue-embedding.entity';
import { PrecedentIssueFindingEntity } from '../entities/precedent-issue-finding.entity';
import { PrecedentSearchDocumentEntity } from '../entities/precedent-search-document.entity';
import { PrecedentEntity } from '../entities/precedent.entity';

export const PRECEDENT_MODEL_NAMES = [
  'precedents',
  'precedent-analyses',
  'precedent-analysis-issues',
  'precedent-issue-findings',
  'precedent-issue-embeddings',
  'precedent-search-documents',
] as const;

export type PrecedentModelName = (typeof PRECEDENT_MODEL_NAMES)[number];

interface ModelQueryOptions {
  page: number;
  limit: number;
  precedentId?: string;
  issueId?: string;
}

interface ModelConfig {
  entity: EntityTarget<ObjectLiteral>;
  precedentField?: string;
  issueField?: string;
  orderBy: Array<[string, 'ASC' | 'DESC']>;
}

const MODEL_CONFIGS: Record<PrecedentModelName, ModelConfig> = {
  precedents: {
    entity: PrecedentEntity,
    precedentField: 'externalId',
    orderBy: [['updatedAt', 'DESC']],
  },
  'precedent-analyses': {
    entity: PrecedentAnalysisEntity,
    precedentField: 'precedentId',
    orderBy: [['updatedAt', 'DESC']],
  },
  'precedent-analysis-issues': {
    entity: PrecedentAnalysisIssueEntity,
    precedentField: 'precedentId',
    issueField: 'id',
    orderBy: [
      ['precedentId', 'ASC'],
      ['issueOrder', 'ASC'],
    ],
  },
  'precedent-issue-findings': {
    entity: PrecedentIssueFindingEntity,
    issueField: 'issueId',
    orderBy: [
      ['issueId', 'ASC'],
      ['findingOrder', 'ASC'],
    ],
  },
  'precedent-issue-embeddings': {
    entity: PrecedentIssueEmbeddingEntity,
    issueField: 'issueId',
    orderBy: [['updatedAt', 'DESC']],
  },
  'precedent-search-documents': {
    entity: PrecedentSearchDocumentEntity,
    precedentField: 'precedentId',
    orderBy: [
      ['precedentId', 'ASC'],
      ['chunkOrder', 'ASC'],
    ],
  },
};

@Injectable()
export class PrecedentModelQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async findAll(model: string, options: ModelQueryOptions) {
    if (!PRECEDENT_MODEL_NAMES.includes(model as PrecedentModelName)) {
      throw new BadRequestException(
        `model은 ${PRECEDENT_MODEL_NAMES.join(', ')} 중 하나여야 합니다.`,
      );
    }

    const modelName = model as PrecedentModelName;
    const config = MODEL_CONFIGS[modelName];
    const page = Math.max(1, options.page);
    const limit = Math.min(50, Math.max(1, options.limit));
    const repository = this.dataSource.getRepository(config.entity);
    const queryBuilder = repository.createQueryBuilder('model');

    if (options.precedentId && config.precedentField) {
      queryBuilder.andWhere(`model.${config.precedentField} = :precedentId`, {
        precedentId: options.precedentId,
      });
    }

    if (options.issueId && config.issueField) {
      queryBuilder.andWhere(`model.${config.issueField} = :issueId`, {
        issueId: options.issueId,
      });
    }

    config.orderBy.forEach(([field, direction], index) => {
      if (index === 0) {
        queryBuilder.orderBy(`model.${field}`, direction);
      } else {
        queryBuilder.addOrderBy(`model.${field}`, direction);
      }
    });

    const [items, totalCount] = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      model: modelName,
      entity: repository.metadata.targetName,
      table: repository.metadata.tableName,
      totalCount,
      page,
      limit,
      items,
    };
  }
}
