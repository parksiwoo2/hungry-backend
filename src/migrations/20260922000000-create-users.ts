import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers20260922000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
        nick_name varchar(30) NOT NULL UNIQUE,
        masking_icon varchar(5) NOT NULL DEFAULT 'NONE' CHECK (masking_icon IN ('NONE', 'NOTE', 'CALCU')),
        secret_password_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE user_sessions (
        token_hash char(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_user_sessions_user ON user_sessions(user_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE user_sessions');
    await queryRunner.query('DROP TABLE users');
  }
}
