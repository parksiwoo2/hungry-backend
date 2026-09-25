import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type ChatRole = 'user' | 'assistant';

@Entity('chat_messages')
@Unique(['sessionId', 'seq'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  /** 세션 안 순번(1부터). 정렬 기준 */
  @Column({ type: 'integer' })
  seq!: number;

  @Column({ type: 'varchar', length: 9 })
  role!: ChatRole;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
