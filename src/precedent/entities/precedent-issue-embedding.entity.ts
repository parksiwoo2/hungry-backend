import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('precedent_issue_embeddings')
export class PrecedentIssueEmbeddingEntity {
  @PrimaryColumn({ name: 'issue_id', type: 'uuid' })
  issueId!: string;

  @Column({ name: 'embedding_model', type: 'varchar', length: 64 })
  embeddingModel!: string;

  @Column({ name: 'summary_content_hash', type: 'char', length: 64 })
  summaryContentHash!: string;

  @Column({ name: 'fact_content_hash', type: 'char', length: 64 })
  factContentHash!: string;

  @Column({ name: 'rule_content_hash', type: 'char', length: 64 })
  ruleContentHash!: string;

  @Column({
    name: 'summary_embedding',
    type: 'vector',
    length: 1536,
    select: false,
  })
  summaryEmbedding!: number[];

  @Column({
    name: 'fact_embedding',
    type: 'vector',
    length: 1536,
    select: false,
  })
  factEmbedding!: number[];

  @Column({
    name: 'rule_embedding',
    type: 'vector',
    length: 1536,
    select: false,
  })
  ruleEmbedding!: number[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
