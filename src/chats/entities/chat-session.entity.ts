import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ChatSessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  /** 고위험(자해·자살 암시) 감지로 일반 상담을 중단한 세션 */
  CRISIS_CLOSED = 'CRISIS_CLOSED',
}

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'analysis_id', type: 'text' })
  analysisId!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: ChatSessionStatus.ACTIVE,
  })
  status!: ChatSessionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
