import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { CallEvent } from '../../common/call/call-event';
import { callFromHash, CallRecord } from '../../common/call/call-record';
import { AppConfig } from '../../config/configuration';
import { CallEventRepository } from '../../infrastructure/database/repositories/call-event.repository';
import { CallRepository } from '../../infrastructure/database/repositories/call.repository';
import { TransactionRunner } from '../../infrastructure/database/transaction.runner';
import { CallEventStreamRepository } from '../../infrastructure/redis/repositories/call-event-stream.repository';

/** Upper bound of batches per run, so one run can't monopolise the worker. */
const MAX_BATCHES_PER_RUN = 20;

export interface FlushResult {
  events: number;
  calls: number;
}

/**
 * Periodically drains the Redis event stream into MySQL.
 *
 * - `call_events`: every event, bulk INSERT IGNORE (append-only, idempotent).
 * - `calls`: only from events carrying a snapshot (created, completed,
 *   recording finished), latest snapshot per call, one bulk upsert.
 *   Intermediate states (RINGING, ANSWERED…) never rewrite the calls row.
 *
 * Both writes share one transaction; stream entries are acked only after
 * commit, so a crash just means the batch is re-delivered and re-applied.
 */
@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name);
  private readonly batchSize: number;
  private readonly consumer = `${hostname()}-${process.pid}`;
  private groupReady = false;

  constructor(
    private readonly stream: CallEventStreamRepository,
    private readonly calls: CallRepository,
    private readonly callEvents: CallEventRepository,
    private readonly tx: TransactionRunner,
    config: ConfigService<AppConfig, true>,
  ) {
    this.batchSize = config.get('persistence.batchSize', { infer: true });
  }

  async flush(): Promise<FlushResult> {
    if (!this.groupReady) {
      await this.stream.ensureGroup();
      this.groupReady = true;
    }

    const total: FlushResult = { events: 0, calls: 0 };
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const entries = await this.stream.readBatch(
        this.consumer,
        this.batchSize,
      );
      if (!entries.length) break;

      const events: CallEvent[] = entries.map((e) => e.event);
      const latestSnapshots = new Map<string, CallRecord>();
      for (const { snapshot } of entries) {
        const call = snapshot && callFromHash(snapshot);
        if (call) latestSnapshots.set(call.id, call); // stream order: last wins
      }
      const calls = [...latestSnapshots.values()];

      // Calls first: call_events rows reference calls (FK).
      await this.tx.run(async (manager) => {
        await this.calls.upsertMany(calls, manager);
        await this.callEvents.insertMany(events, manager);
      });
      await this.stream.ack(entries.map((e) => e.id));

      total.events += events.length;
      total.calls += calls.length;
      if (entries.length < this.batchSize) break;
    }

    if (total.events) {
      this.logger.debug(
        `Persisted ${total.events} event(s), ${total.calls} call row(s)`,
      );
    }
    return total;
  }
}
