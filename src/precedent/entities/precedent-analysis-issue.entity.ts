import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { EvidenceTextType } from '../analysis/precedent-analysis.types';

@Entity('precedent_analysis_issues')
@Index('IDX_precedent_analysis_issues_precedent', ['precedentId'])
@Index('UQ_precedent_analysis_issues_order', ['precedentId', 'issueOrder'], {
  unique: true,
})
export class PrecedentAnalysisIssueEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'precedent_id', type: 'varchar', length: 32 })
  precedentId!: string;

  @Column({ name: 'issue_order', type: 'integer' })
  issueOrder!: number;

  @Column({ name: 'evidence_type', type: 'varchar', length: 40 })
  evidenceType!: EvidenceTextType;

  @Column({ name: 'evidence_texts', type: 'text', array: true })
  evidenceTexts!: string[];

  @Column({ name: 'fact_pattern', type: 'text' })
  factPattern!: string;

  @Column({ name: 'search_summary', type: 'text' })
  searchSummary!: string;

  @Column({ name: 'is_group_chat', type: 'boolean', nullable: true })
  isGroupChat!: boolean | null;

  @Column({ name: 'audience_count', type: 'integer', nullable: true })
  audienceCount!: number | null;

  @Column({ name: 'victim_identifiable', type: 'boolean', nullable: true })
  victimIdentifiable!: boolean | null;

  @Column({
    name: 'crime_types',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  crimeTypes!: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  keywords!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
