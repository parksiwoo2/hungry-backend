import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Safe Guard 대화 분석 저장소 — 세션(업로드 자료) · 분석 · 의심 구간.
 *
 * 로그인 세션(user_sessions)·판례 분석(precedent_analyses)과 헷갈리지 않게 safeguard_ 접두사를 쓴다.
 * 배열·객체 필드는 jsonb 가 아니라 json 이다 — 조회 조건으로 쓰지 않고, jsonb 는 객체 키를
 * 재정렬해 응답의 typeCounts·precedents 순서가 바뀌기 때문이다.
 * 세션 삭제는 분석이 남아 있으면 FK(RESTRICT)가 막는다.
 */
export class CreateSafeguardTables20261005000000 implements MigrationInterface {
  name = 'CreateSafeguardTables20261005000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE safeguard_sessions (
        id                 text PRIMARY KEY,
        source             text NOT NULL,
        format             text NOT NULL,
        messages           json NOT NULL,
        message_count      integer NOT NULL,
        system_event_count integer NOT NULL,
        participants       json NOT NULL,
        period_from        text,
        period_to          text,
        created_at         timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE safeguard_analyses (
        id                text PRIMARY KEY,
        seq               bigint GENERATED ALWAYS AS IDENTITY,
        context           text NOT NULL,
        victim_name       text NOT NULL,
        participant_count integer NOT NULL,
        status            text NOT NULL CHECK (status IN ('running', 'done', 'error')),
        error             text,
        patterns          json NOT NULL DEFAULT '[]',
        summary           json,
        precedents        json NOT NULL DEFAULT '{}',
        created_at        timestamptz NOT NULL,
        finished_at       timestamptz
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_safeguard_analyses_created ON safeguard_analyses(created_at DESC, seq DESC)',
    );
    await queryRunner.query(`
      CREATE TABLE safeguard_analysis_sessions (
        analysis_id text NOT NULL REFERENCES safeguard_analyses(id) ON DELETE CASCADE,
        session_id  text NOT NULL REFERENCES safeguard_sessions(id) ON DELETE RESTRICT,
        ord         integer NOT NULL,
        PRIMARY KEY (analysis_id, session_id)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_safeguard_analysis_sessions_session ON safeguard_analysis_sessions(session_id)',
    );
    await queryRunner.query(`
      CREATE TABLE safeguard_utterances (
        id                    text PRIMARY KEY,
        analysis_id           text NOT NULL REFERENCES safeguard_analyses(id) ON DELETE CASCADE,
        session_id            text NOT NULL,
        seq                   integer NOT NULL,
        message_nos           json NOT NULL,
        harm_types            json NOT NULL,
        severity              text NOT NULL,
        reason                text NOT NULL,
        applied_precedent_ids json NOT NULL,
        excluded              boolean NOT NULL DEFAULT false
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_safeguard_utterances_analysis ON safeguard_utterances(analysis_id, seq)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE safeguard_utterances');
    await queryRunner.query('DROP TABLE safeguard_analysis_sessions');
    await queryRunner.query('DROP TABLE safeguard_analyses');
    await queryRunner.query('DROP TABLE safeguard_sessions');
  }
}
