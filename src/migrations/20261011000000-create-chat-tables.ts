import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI 심리 상담 챗봇 저장소 — 상담 세션과 대화 메시지.
 *
 * 상담 내용은 분석에서 파생된 민감 정보라 분석이 삭제되면 함께 지워지도록 FK 를 CASCADE 로 건다.
 * 메시지는 (세션, 순번) 으로 정렬한다 — created_at 은 같은 트랜잭션의 두 행이 같은 값이라 순서를 못 정한다.
 */
export class CreateChatTables20261011000000 implements MigrationInterface {
  name = 'CreateChatTables20261011000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE chat_sessions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        analysis_id text NOT NULL REFERENCES safeguard_analyses(id) ON DELETE CASCADE,
        status      varchar(16) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'ENDED', 'CRISIS_CLOSED')),
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_chat_sessions_analysis ON chat_sessions(analysis_id)',
    );
    await queryRunner.query(`
      CREATE TABLE chat_messages (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        seq         integer NOT NULL,
        role        varchar(9) NOT NULL CHECK (role IN ('user', 'assistant')),
        content     text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (session_id, seq)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE chat_messages');
    await queryRunner.query('DROP TABLE chat_sessions');
  }
}
