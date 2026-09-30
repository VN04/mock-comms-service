import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Queues } from '../../common/constants/queues';
import { AppConfig } from '../../config/configuration';
import { FlushResult, PersistenceService } from './persistence.service';

const SCHEDULER_ID = 'flush-call-events';

/**
 * Runs the flush every PERSISTENCE_FLUSH_INTERVAL_MS via a BullMQ job
 * scheduler — a single schedule shared by all worker replicas, and at most
 * one flush runs at a time (concurrency 1).
 */
@Processor(Queues.PERSISTENCE, { concurrency: 1 })
export class PersistenceProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly intervalMs: number;

  constructor(
    private readonly persistence: PersistenceService,
    @InjectQueue(Queues.PERSISTENCE) private readonly queue: Queue,
    config: ConfigService<AppConfig, true>,
  ) {
    super();
    this.intervalMs = config.get('persistence.flushIntervalMs', {
      infer: true,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: this.intervalMs },
      { name: 'flush', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  process(): Promise<FlushResult> {
    return this.persistence.flush();
  }

  /** Final flush on graceful shutdown so nothing waits for the next tick. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.persistence.flush().catch(() => undefined);
  }
}
