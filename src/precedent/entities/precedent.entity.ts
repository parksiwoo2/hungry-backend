import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('precedents')
@Index('IDX_precedents_case_number', ['caseNumber'])
@Index('IDX_precedents_judgement_date', ['judgementDate'])
export class PrecedentEntity {
  @PrimaryColumn({ name: 'external_id', type: 'varchar', length: 32 })
  externalId!: string;

  @Column({ name: 'case_number', type: 'text', nullable: true })
  caseNumber!: string | null;

  @Column({ name: 'case_name', type: 'text', nullable: true })
  caseName!: string | null;

  @Column({ name: 'court_name', type: 'text', nullable: true })
  courtName!: string | null;

  @Column({
    name: 'court_type_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  courtTypeCode!: string | null;

  @Column({
    name: 'judgement_date',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  judgementDate!: string | null;

  @Column({ name: 'sentence_type', type: 'text', nullable: true })
  sentenceType!: string | null;

  @Column({ name: 'case_type', type: 'text', nullable: true })
  caseType!: string | null;

  @Column({
    name: 'case_type_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  caseTypeCode!: string | null;

  @Column({ name: 'judgement_type', type: 'text', nullable: true })
  judgementType!: string | null;

  @Column({ name: 'data_source', type: 'text', nullable: true })
  dataSource!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'text', nullable: true })
  gist!: string | null;

  @Column({ name: 'ref_laws', type: 'text', nullable: true })
  refLaws!: string | null;

  @Column({ name: 'ref_cases', type: 'text', nullable: true })
  refCases!: string | null;

  @Column({ name: 'full_content', type: 'text', nullable: true })
  fullContent!: string | null;

  @Column({ name: 'matched_categories', type: 'text', array: true })
  matchedCategories!: string[];

  @Column({ name: 'matched_queries', type: 'text', array: true })
  matchedQueries!: string[];

  @Column({
    name: 'raw_detail_html',
    type: 'text',
    nullable: true,
    select: false,
  })
  rawDetailHtml!: string | null;

  @Column({
    name: 'detail_status',
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  detailStatus!: string;

  @Column({ name: 'detail_error', type: 'text', nullable: true })
  detailError!: string | null;

  @Column({ name: 'detail_fetched_at', type: 'timestamptz', nullable: true })
  detailFetchedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
