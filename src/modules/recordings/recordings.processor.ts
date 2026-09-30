import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Queues } from '../../common/constants/queues';
import { RecordingJobData, RecordingsService } from './recordings.service';

/** Worker-side consumer of the recordings queue. */
@Processor(Queues.RECORDINGS, { concurrency: 10 })
export class RecordingsProcessor extends WorkerHost {
  constructor(private readonly recordings: RecordingsService) {
    super();
  }

  async process(job: Job<RecordingJobData>): Promise<void> {
    const attempt = job.attemptsMade + 1;
    try {
      await this.recordings.upload(job.data.callId, attempt);
    } catch (err) {
      const isFinal = attempt >= (job.opts.attempts ?? 1);
      await this.recordings.recordFailure(
        job.data.callId,
        attempt,
        err as Error,
        isFinal,
      );
      throw err; // let BullMQ schedule the retry (exponential backoff)
    }
  }
}
