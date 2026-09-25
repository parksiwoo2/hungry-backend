import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

// Node.js 24+ 내장 SQLite (--experimental-sqlite 플래그 필요)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

export type SessionStatus = 'ACTIVE' | 'ENDED' | 'CRISIS_CLOSED';
export type MessageRole = 'user' | 'model';

export interface ChatSession {
  id: string;
  analysisId: string;
  status: SessionStatus;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db: InstanceType<typeof DatabaseSync>;

  onModuleInit() {
    this.db = new DatabaseSync('./dev.db');
    this.migrate();
    this.logger.log('SQLite DB 초기화 완료 (dev.db)');
  }

  onModuleDestroy() {
    this.db?.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
      );
    `);
  }

  // ── ChatSession ──────────────────────────────────────────────
  createSession(analysisId: string): ChatSession {
    const session: ChatSession = {
      id: randomUUID(),
      analysisId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    const stmt = this.db.prepare(
      'INSERT INTO chat_sessions (id, analysis_id, status, created_at) VALUES (?, ?, ?, ?)',
    );
    stmt.run(session.id, session.analysisId, session.status, session.createdAt);
    return session;
  }

  findSession(id: string): ChatSession | null {
    const stmt = this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?');
    const row = stmt.get(id) as Record<string, string> | undefined;
    if (!row) return null;
    return {
      id: row.id,
      analysisId: row.analysis_id,
      status: row.status as SessionStatus,
      createdAt: row.created_at,
    };
  }

  updateSessionStatus(id: string, status: SessionStatus) {
    const stmt = this.db.prepare('UPDATE chat_sessions SET status = ? WHERE id = ?');
    stmt.run(status, id);
  }

  // ── ChatMessage ──────────────────────────────────────────────
  createMessage(sessionId: string, role: MessageRole, content: string): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    const stmt = this.db.prepare(
      'INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(message.id, message.sessionId, message.role, message.content, message.createdAt);
    return message;
  }

  findMessagesBySession(sessionId: string): ChatMessage[] {
    const stmt = this.db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC',
    );
    const rows = stmt.all(sessionId) as Record<string, string>[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      createdAt: row.created_at,
    }));
  }
}
