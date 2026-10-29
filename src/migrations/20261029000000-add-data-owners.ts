import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDataOwners20261029000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()',
    );
    // 기존 데이터는 소유자를 추측하지 않는다. NULL 소유자는 API에서 조회되지 않는다.
    // 탈퇴한 사용자의 자료도 소유권을 해제해 접근을 차단한다.
    await runner.query(`ALTER TABLE safeguard_sessions ADD COLUMN user_id uuid
      REFERENCES users(id) ON DELETE SET NULL`);
    await runner.query(`ALTER TABLE safeguard_analyses ADD COLUMN user_id uuid
      REFERENCES users(id) ON DELETE SET NULL`);
    await runner.query(
      'CREATE INDEX idx_safeguard_sessions_user ON safeguard_sessions(user_id)',
    );
    await runner.query(
      'CREATE INDEX idx_safeguard_analyses_user_created ON safeguard_analyses(user_id, created_at DESC, seq DESC)',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE users ALTER COLUMN id DROP DEFAULT');
    await runner.query('ALTER TABLE safeguard_analyses DROP COLUMN user_id');
    await runner.query('ALTER TABLE safeguard_sessions DROP COLUMN user_id');
  }
}
