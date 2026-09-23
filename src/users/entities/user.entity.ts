import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MaskingIcon {
  NONE = 'NONE',
  NOTE = 'NOTE',
  CALCU = 'CALCU',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 254, unique: true })
  email!: string;

  @Column({ name: 'nick_name', length: 30, unique: true })
  nickName!: string;

  @Column({
    name: 'masking_icon',
    type: 'varchar',
    length: 5,
    default: MaskingIcon.NONE,
  })
  maskingIcon!: MaskingIcon;

  @Column({
    name: 'secret_password_hash',
    type: 'text',
    nullable: true,
    select: false,
  })
  secretPasswordHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
