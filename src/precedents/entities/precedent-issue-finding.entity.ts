import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { CourtLevel } from '../analysis/precedent-analysis.types';

@Entity('precedent_issue_findings')
@Index('IDX_precedent_issue_findings_issue', ['issueId'])
@Index('UQ_precedent_issue_findings_order', ['issueId', 'findingOrder'], {
  unique: true,
})
export class PrecedentIssueFindingEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'issue_id', type: 'uuid' })
  issueId!: string;

  @Column({ name: 'finding_order', type: 'integer' })
  findingOrder!: number;

  @Column({ name: 'court_name', type: 'text' })
  courtName!: string;

  @Column({ name: 'court_level', type: 'varchar', length: 20 })
  courtLevel!: CourtLevel;

  @Column({ type: 'text' })
  holding!: string;

  @Column({ name: 'evidence_assessment', type: 'text' })
  evidenceAssessment!: string;

  @Column({
    name: 'abstract_rules',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  abstractRules!: string[];

  @Column({ name: 'is_guilty_recognized', type: 'boolean', nullable: true })
  isGuiltyRecognized!: boolean | null;

  @Column({ name: 'evidence_accepted', type: 'boolean', nullable: true })
  evidenceAccepted!: boolean | null;

  @Column({ name: 'publicity_recognized', type: 'boolean', nullable: true })
  publicityRecognized!: boolean | null;

  @Column({ name: 'specificity_recognized', type: 'boolean', nullable: true })
  specificityRecognized!: boolean | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
