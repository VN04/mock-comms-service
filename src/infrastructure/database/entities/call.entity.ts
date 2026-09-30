import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CallStatus, RecordingStatus } from '../../../common/call/call-status';
import type { CallOutcome } from '../../../common/call/call-status';
import { ApiKeyEntity } from './api-key.entity';

const OUTCOMES = [CallStatus.ANSWERED, CallStatus.UNANSWERED];
const timestamp = (name: string, nullable = true) =>
  Column({ name, type: 'datetime', precision: 3, nullable });

/**
 * Durable record of a call. Written in batches by the persistence job
 * (on creation and on completion); live state is served from Redis.
 */
@Entity('calls')
@Index('idx_calls_api_key_status', ['apiKeyId', 'status'])
@Index('idx_calls_created_at', ['createdAt'])
export class CallEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'api_key_id', type: 'char', length: 36 })
  apiKeyId!: string;

  @ManyToOne(() => ApiKeyEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'api_key_id' })
  apiKey?: ApiKeyEntity;

  @Column({ name: 'from_number', type: 'varchar', length: 20 })
  fromNumber!: string;

  @Column({ name: 'to_number', type: 'varchar', length: 20 })
  toNumber!: string;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ type: 'enum', enum: CallStatus })
  status!: CallStatus;

  @Column({ type: 'enum', enum: OUTCOMES, nullable: true })
  outcome!: CallOutcome | null;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @timestamp('queued_at', false)
  queuedAt!: Date;

  @timestamp('ringing_at')
  ringingAt!: Date | null;

  @timestamp('answered_at')
  answeredAt!: Date | null;

  @timestamp('unanswered_at')
  unansweredAt!: Date | null;

  @timestamp('completed_at')
  completedAt!: Date | null;

  @Column({
    name: 'recording_status',
    type: 'enum',
    enum: RecordingStatus,
    nullable: true,
  })
  recordingStatus!: RecordingStatus | null;

  @Column({
    name: 'recording_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  recordingKey!: string | null;

  @Column({
    name: 'recording_url',
    type: 'varchar',
    length: 1024,
    nullable: true,
  })
  recordingUrl!: string | null;

  @timestamp('recording_uploaded_at')
  recordingUploadedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
