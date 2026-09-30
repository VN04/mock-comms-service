import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Queues } from '../../../common/constants/queues';
import { CallLifecycleService } from '../../call-lifecycle/call-lifecycle.service';
import { MockCallProvider, MockStepJobData } from './mock-call.provider';

/** Worker-side: applies a simulated step, then schedules the following one. */
@Processor(Queues.MOCK_PROVIDER, { concurrency: 50 })
export class MockCallProcessor extends WorkerHost {
  constructor(
    private readonly lifecycle: CallLifecycleService,
    private readonly provider: MockCallProvider,
  ) {
    super();
  }

  async process(job: Job<MockStepJobData>): Promise<void> {
    const { callId, from, to } = job.data;
    const result = await this.lifecycle.transition(callId, from, to);

    // Also continue when this step was already applied by an earlier attempt
    // that crashed before scheduling the next one (jobId de-dupes the rest).
    const reachedTarget =
      result.applied ||
      (result.reason === 'CONFLICT' && result.currentStatus === to);
    if (reachedTarget) await this.provider.scheduleNextStep(callId, to);
  }
}
