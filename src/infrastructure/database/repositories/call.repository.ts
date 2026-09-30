import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CallRecord } from '../../../common/call/call-record';
import { CallEntity } from '../entities/call.entity';

/** Columns refreshed when a snapshot for an existing call is upserted. */
const UPSERT_COLUMNS = [
  'status',
  'outcome',
  'ringing_at',
  'answered_at',
  'unanswered_at',
  'completed_at',
  'recording_status',
  'recording_key',
  'recording_url',
  'recording_uploaded_at',
  'updated_at',
];

const toDate = (ms: number | null): Date | null =>
  ms === null ? null : new Date(ms);
const toMs = (d: Date | null): number | null => (d ? d.getTime() : null);

/** MySQL access for the durable `calls` table. */
@Injectable()
export class CallRepository {
  constructor(
    @InjectRepository(CallEntity)
    private readonly repo: Repository<CallEntity>,
  ) {}

  async findById(id: string): Promise<CallRecord | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toRecord(entity) : null;
  }

  /**
   * Bulk INSERT ... ON DUPLICATE KEY UPDATE in a single statement.
   * Snapshots are full states, so replaying one is harmless (idempotent).
   */
  async upsertMany(
    calls: CallRecord[],
    manager?: EntityManager,
  ): Promise<void> {
    if (!calls.length) return;
    const repo = manager ? manager.getRepository(CallEntity) : this.repo;
    await repo
      .createQueryBuilder()
      .insert()
      .values(calls.map(toEntity))
      .orUpdate(UPSERT_COLUMNS, ['id'])
      .updateEntity(false)
      .execute();
  }
}

function toEntity(call: CallRecord): Partial<CallEntity> {
  return {
    id: call.id,
    apiKeyId: call.apiKeyId,
    fromNumber: call.from,
    toNumber: call.to,
    metadata: call.metadata,
    status: call.status,
    outcome: call.outcome,
    provider: call.provider,
    queuedAt: new Date(call.queuedAt),
    ringingAt: toDate(call.ringingAt),
    answeredAt: toDate(call.answeredAt),
    unansweredAt: toDate(call.unansweredAt),
    completedAt: toDate(call.completedAt),
    recordingStatus: call.recordingStatus,
    recordingKey: call.recordingKey,
    recordingUrl: call.recordingUrl,
    recordingUploadedAt: toDate(call.recordingUploadedAt),
    updatedAt: new Date(call.updatedAt),
  };
}

function toRecord(e: CallEntity): CallRecord {
  return {
    id: e.id,
    apiKeyId: e.apiKeyId,
    from: e.fromNumber,
    to: e.toNumber,
    metadata: e.metadata,
    status: e.status,
    outcome: e.outcome,
    provider: e.provider,
    queuedAt: e.queuedAt.getTime(),
    ringingAt: toMs(e.ringingAt),
    answeredAt: toMs(e.answeredAt),
    unansweredAt: toMs(e.unansweredAt),
    completedAt: toMs(e.completedAt),
    recordingStatus: e.recordingStatus,
    recordingKey: e.recordingKey,
    recordingUrl: e.recordingUrl,
    recordingUploadedAt: toMs(e.recordingUploadedAt),
    updatedAt: e.updatedAt.getTime(),
    lastSequence: null,
  };
}
