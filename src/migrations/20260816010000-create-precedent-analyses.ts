import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrecedentAnalyses20260816010000 implements MigrationInterface {
  name = 'CreatePrecedentAnalyses20260816010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precedent_analyses" (
        "precedent_id" varchar(32) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "source_content_hash" char(64) NOT NULL,
        "prompt_version" varchar(32) NOT NULL,
        "analysis_model" varchar(64) NOT NULL,
        "embedding_model" varchar(64) NOT NULL,
        "issue_count" integer NOT NULL DEFAULT 0,
        "error" text,
        "analyzed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_precedent_analyses" PRIMARY KEY ("precedent_id"),
        CONSTRAINT "FK_precedent_analyses_precedent"
          FOREIGN KEY ("precedent_id") REFERENCES "precedents"("external_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_analyses_status"
      ON "precedent_analyses" ("status")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precedent_analysis_issues" (
        "id" uuid NOT NULL,
        "precedent_id" varchar(32) NOT NULL,
        "issue_order" integer NOT NULL,
        "evidence_type" varchar(40) NOT NULL,
        "evidence_texts" text[] NOT NULL,
        "fact_pattern" text NOT NULL,
        "search_summary" text NOT NULL,
        "is_group_chat" boolean,
        "audience_count" integer,
        "victim_identifiable" boolean,
        "crime_types" text[] NOT NULL DEFAULT '{}',
        "keywords" text[] NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_precedent_analysis_issues" PRIMARY KEY ("id"),
        CONSTRAINT "FK_precedent_analysis_issues_precedent"
          FOREIGN KEY ("precedent_id") REFERENCES "precedent_analyses"("precedent_id")
          ON DELETE CASCADE,
        CONSTRAINT "UQ_precedent_analysis_issues_order"
          UNIQUE ("precedent_id", "issue_order")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_analysis_issues_precedent"
      ON "precedent_analysis_issues" ("precedent_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_analysis_issues_crime_types"
      ON "precedent_analysis_issues" USING gin ("crime_types")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_analysis_issues_keywords"
      ON "precedent_analysis_issues" USING gin ("keywords")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precedent_issue_findings" (
        "id" uuid NOT NULL,
        "issue_id" uuid NOT NULL,
        "finding_order" integer NOT NULL,
        "court_name" text NOT NULL,
        "court_level" varchar(20) NOT NULL,
        "holding" text NOT NULL,
        "evidence_assessment" text NOT NULL,
        "abstract_rules" text[] NOT NULL DEFAULT '{}',
        "is_guilty_recognized" boolean,
        "evidence_accepted" boolean,
        "publicity_recognized" boolean,
        "specificity_recognized" boolean,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_precedent_issue_findings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_precedent_issue_findings_issue"
          FOREIGN KEY ("issue_id") REFERENCES "precedent_analysis_issues"("id")
          ON DELETE CASCADE,
        CONSTRAINT "UQ_precedent_issue_findings_order"
          UNIQUE ("issue_id", "finding_order")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_issue_findings_issue"
      ON "precedent_issue_findings" ("issue_id")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precedent_issue_embeddings" (
        "issue_id" uuid NOT NULL,
        "embedding_model" varchar(64) NOT NULL,
        "summary_content_hash" char(64) NOT NULL,
        "fact_content_hash" char(64) NOT NULL,
        "rule_content_hash" char(64) NOT NULL,
        "summary_embedding" vector(1536) NOT NULL,
        "fact_embedding" vector(1536) NOT NULL,
        "rule_embedding" vector(1536) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_precedent_issue_embeddings" PRIMARY KEY ("issue_id"),
        CONSTRAINT "FK_precedent_issue_embeddings_issue"
          FOREIGN KEY ("issue_id") REFERENCES "precedent_analysis_issues"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_issue_embeddings_summary_hnsw"
      ON "precedent_issue_embeddings"
      USING hnsw ("summary_embedding" vector_cosine_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_issue_embeddings_fact_hnsw"
      ON "precedent_issue_embeddings"
      USING hnsw ("fact_embedding" vector_cosine_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_issue_embeddings_rule_hnsw"
      ON "precedent_issue_embeddings"
      USING hnsw ("rule_embedding" vector_cosine_ops)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precedent_search_documents" (
        "precedent_id" varchar(32) NOT NULL,
        "chunk_order" integer NOT NULL,
        "search_text" text NOT NULL,
        "crime_types" text[] NOT NULL DEFAULT '{}',
        "keywords" text[] NOT NULL DEFAULT '{}',
        "fts_vector" tsvector GENERATED ALWAYS AS (
          to_tsvector('simple'::regconfig, coalesce("search_text", ''))
        ) STORED,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_precedent_search_documents"
          PRIMARY KEY ("precedent_id", "chunk_order"),
        CONSTRAINT "FK_precedent_search_documents_precedent"
          FOREIGN KEY ("precedent_id") REFERENCES "precedent_analyses"("precedent_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_search_documents_fts"
      ON "precedent_search_documents" USING gin ("fts_vector")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_search_documents_crime_types"
      ON "precedent_search_documents" USING gin ("crime_types")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedent_search_documents_keywords"
      ON "precedent_search_documents" USING gin ("keywords")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "precedent_search_documents"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "precedent_issue_embeddings"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "precedent_issue_findings"');
    await queryRunner.query('DROP TABLE IF EXISTS "precedent_analysis_issues"');
    await queryRunner.query('DROP TABLE IF EXISTS "precedent_analyses"');
  }
}
