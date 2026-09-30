import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CallEvent } from '../../../common/call/call-event';
import { CallEventEntity } from '../entities/call-event.entity';

/** MySQL access for the append-only `call_events` table. */
@Injectable()
export class CallEventRepository {
  constructor(
    @InjectRepository(CallEventEntity)
    private readonly repo: Repository<CallEventEntity>,
  ) {}

  /**
   * Bulk INSERT IGNORE: a re-delivered event hits the (call_id, sequence)
   * unique key and is skipped, so replays never create duplicates.
   */
  async insertMany(
    events: CallEvent[],
    manager?: EntityManager,
  ): Promise<void> {
    if (!events.length) return;
    const repo = manager ? manager.getRepository(CallEventEntity) : this.repo;
    await repo
      .createQueryBuilder()
      .insert()
      .values(
        events.map((e): Partial<CallEventEntity> => ({
          callId: e.callId,
          sequence: e.sequence,
          eventType: e.type,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          payload: e.payload,
          occurredAt: new Date(e.occurredAt),
        })),
      )
      .orIgnore()
      .updateEntity(false)
      .execute();
  }

  async findByCallId(callId: string): Promise<CallEvent[]> {
    const rows = await this.repo.find({
      where: { callId },
      order: { sequence: 'ASC' },
    });
    return rows.map((r) => ({
      callId: r.callId,
      sequence: r.sequence,
      type: r.eventType,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      payload: r.payload,
      occurredAt: r.occurredAt.getTime(),
    }));
  }
}
