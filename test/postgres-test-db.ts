import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ChatMessage } from '../src/chats/entities/chat-message.entity';
import { ChatSession } from '../src/chats/entities/chat-session.entity';
import { CreateSafeguardTables20261005000000 } from '../src/migrations/20261005000000-create-safeguard-tables';
import { CreateChatTables20261011000000 } from '../src/migrations/20261011000000-create-chat-tables';

export async function openTestDatabase() {
  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  const options = {
    type: 'postgres' as const,
    url:
      process.env.TEST_DATABASE_URL ||
      'postgres://postgres:postgres@127.0.0.1:15432/hungry_test',
    connectTimeoutMS: 5000,
  };
  const admin = new DataSource(options);
  await admin.initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new DataSource({
    ...options,
    schema,
    extra: { options: `-c search_path=${schema}` },
    entities: [ChatSession, ChatMessage],
    migrations: [
      CreateSafeguardTables20261005000000,
      CreateChatTables20261011000000,
    ],
    synchronize: false,
  });
  const close = async () => {
    try {
      if (db.isInitialized) await db.destroy();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.destroy();
    }
  };
  try {
    await db.initialize();
    await db.runMigrations();
    return { db, close };
  } catch (error) {
    await close();
    throw error;
  }
}
