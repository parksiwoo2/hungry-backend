import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsurePrecedentSchema20260816000000 implements MigrationInterface {
  name = 'EnsurePrecedentSchema20260816000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precedents" (
        "external_id" varchar(32) NOT NULL,
        "case_number" text,
        "case_name" text,
        "court_name" text,
        "court_type_code" varchar(32),
        "judgement_date" varchar(16),
        "sentence_type" text,
        "case_type" text,
        "case_type_code" varchar(32),
        "judgement_type" text,
        "data_source" text,
        "summary" text,
        "gist" text,
        "ref_laws" text,
        "ref_cases" text,
        "full_content" text,
        "matched_categories" text[] NOT NULL,
        "matched_queries" text[] NOT NULL,
        "raw_detail_html" text,
        "detail_status" varchar(20) NOT NULL DEFAULT 'pending',
        "detail_error" text,
        "detail_fetched_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_39e171484b9ec3e708550704f37" PRIMARY KEY ("external_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedents_case_number"
      ON "precedents" ("case_number")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_precedents_judgement_date"
      ON "precedents" ("judgement_date")
    `);
    await queryRunner.query(`
      ALTER TABLE "precedents"
      DROP COLUMN IF EXISTS "list_payload",
      DROP COLUMN IF EXISTS "detail_payload"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "precedents"
      ADD COLUMN IF NOT EXISTS "list_payload" jsonb,
      ADD COLUMN IF NOT EXISTS "detail_payload" jsonb
    `);
  }
}
