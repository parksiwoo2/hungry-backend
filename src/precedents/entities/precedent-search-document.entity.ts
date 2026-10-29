import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('precedent_search_documents')
export class PrecedentSearchDocumentEntity {
  @PrimaryColumn({ name: 'precedent_id', type: 'varchar', length: 32 })
  precedentId!: string;

  @PrimaryColumn({ name: 'chunk_order', type: 'integer' })
  chunkOrder!: number;

  @Column({ name: 'search_text', type: 'text' })
  searchText!: string;

  @Column({ name: 'crime_types', type: 'text', array: true })
  crimeTypes!: string[];

  @Column({ type: 'text', array: true })
  keywords!: string[];

  @Column({
    name: 'fts_vector',
    type: 'tsvector',
    select: false,
    insert: false,
    update: false,
  })
  ftsVector!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
