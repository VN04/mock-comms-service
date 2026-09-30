import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { CallRecord } from '../../../common/call/call-record';
import { CallStatus } from '../../../common/call/call-status';
import { Queues } from '../../../common/constants/queues';
import { randomInt } from '../../../common/utils/random';
import { AppConfig } from '../../../config/configuration';
import { CallProvider } from '../call-provider.interface';

export interface MockStepJobData {
  callId: string;
  from: CallStatus;
  to: CallStatus;
}

export interface PlannedStep {
  to: CallStatus;
  delayMs: number;
}

/**
 * Simulated carrier. Each step is a BullMQ *delayed job* (not an in-process
 * timer), so progress survives restarts and is shared across worker replicas.
 * Path: QUEUED → RINGING → (ANSWERED | UNANSWERED) → COMPLETED.
 */
@Injectable()
export class MockCallProvider implements CallProvider {
  readonly name = 'mock';
  private readonly cfg: AppConfig['callProvider']['mock'];

  constructor(
    @InjectQueue(Queues.MOCK_PROVIDER) private readonly queue: Queue,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cfg = config.get('callProvider.mock', { infer: true });
  }

  dial(call: CallRecord): Promise<void> {
    return this.scheduleNextStep(call.id, CallStatus.QUEUED);
  }

  /** Schedules the transition out of `current` (no-op once COMPLETED). */
  async scheduleNextStep(callId: string, current: CallStatus): Promise<void> {
    const step = this.planNextStep(current);
    if (!step) return;
    await this.queue.add(
      'step',
      { callId, from: current, to: step.to } satisfies MockStepJobData,
      {
        delay: step.delayMs,
        jobId: `${callId}-${step.to}`, // re-scheduling the same step is a no-op
        attempts: 5,
        backoff: { type: 'exponential', delay: 500 },
      },
    );
  }

  /** Picks the next state and how long until it happens. */
  planNextStep(current: CallStatus): PlannedStep | null {
    const {
      stepDelayMinMs,
      stepDelayMaxMs,
      talkDurationMinMs,
      talkDurationMaxMs,
    } = this.cfg;
    const step = () => randomInt(stepDelayMinMs, stepDelayMaxMs);

    switch (current) {
      case CallStatus.QUEUED:
        return { to: CallStatus.RINGING, delayMs: step() };
      case CallStatus.RINGING:
        return {
          to:
            Math.random() < this.cfg.answerProbability
              ? CallStatus.ANSWERED
              : CallStatus.UNANSWERED,
          delayMs: step(),
        };
      case CallStatus.ANSWERED:
        // An answered call "talks" for a while before hanging up.
        return {
          to: CallStatus.COMPLETED,
          delayMs: randomInt(talkDurationMinMs, talkDurationMaxMs),
        };
      case CallStatus.UNANSWERED:
        return { to: CallStatus.COMPLETED, delayMs: step() };
      case CallStatus.COMPLETED:
        return null;
    }
  }
}
