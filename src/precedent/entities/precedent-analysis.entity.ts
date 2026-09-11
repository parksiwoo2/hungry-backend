import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('precedent_analyses')
@Index('IDX_precedent_analyses_status', ['status'])
export class PrecedentAnalysisEntity {
  @PrimaryColumn({ name: 'precedent_id', type: 'varchar', length: 32 })
  precedentId!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @Column({ name: 'source_content_hash', type: 'char', length: 64 })
  sourceContentHash!: string;

  @Column({ name: 'prompt_version', type: 'varchar', length: 32 })
  promptVersion!: string;

  @Column({ name: 'analysis_model', type: 'varchar', length: 64 })
  analysisModel!: string;

  @Column({ name: 'embedding_model', type: 'varchar', length: 64 })
  embeddingModel!: string;

  @Column({ name: 'issue_count', type: 'integer', default: 0 })
  issueCount!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'analyzed_at', type: 'timestamptz', nullable: true })
  analyzedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
