import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CallEventType } from '../../../common/call/call-event';
import { CallStatus } from '../../../common/call/call-status';
import { CallEntity } from './call.entity';

/**
 * Append-only audit trail of a call's lifecycle.
 * (call_id, sequence) is unique, which makes batch re-inserts idempotent.
 */
@Entity('call_events')
@Index('uq_call_events_call_sequence', ['callId', 'sequence'], {
  unique: true,
})
@Index('idx_call_events_type_occurred', ['eventType', 'occurredAt'])
export class CallEventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'call_id', type: 'char', length: 36 })
  callId!: string;

  @ManyToOne(() => CallEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'call_id' })
  call?: CallEntity;

  @Column({ type: 'int' })
  sequence!: number;

  @Column({ name: 'event_type', type: 'enum', enum: CallEventType })
  eventType!: CallEventType;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: CallStatus,
    nullable: true,
  })
  fromStatus!: CallStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: CallStatus, nullable: true })
  toStatus!: CallStatus | null;

  @Column({ type: 'json', nullable: true })
  payload!: Record<string, any> | null;

  @Column({ name: 'occurred_at', type: 'datetime', precision: 3 })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
