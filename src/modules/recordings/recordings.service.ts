import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CallEventType } from '../../common/call/call-event';
import { RecordingStatus } from '../../common/call/call-status';
import { Queues } from '../../common/constants/queues';
import { AppConfig } from '../../config/configuration';
import {
  CallMutationResult,
  CallStateRepository,
} from '../../infrastructure/redis/repositories/call-state.repository';
import { STORAGE_PROVIDER } from '../../infrastructure/storage/storage.provider';
import type { StorageProvider } from '../../infrastructure/storage/storage.provider';
import { CallUpdatesService } from '../call-updates/call-updates.service';
import { MetricsService } from '../metrics/metrics.service';

export interface RecordingJobData {
  callId: string;
}

const MOCK_RECORDING_PATH = join(process.cwd(), 'assets', 'mock_recording.mp3');
const CONTENT_TYPE = 'audio/mpeg';

export const recordingKeyFor = (callId: string): string =>
  `recordings/${callId}.mp3`;

/**
 * Background recording upload for completed calls: enqueue (API/worker side)
 * and the upload itself (run by RecordingsProcessor in the worker).
 */
@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly attempts: number;
  private recording?: Promise<Buffer>;

  constructor(
    @InjectQueue(Queues.RECORDINGS) private readonly queue: Queue,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly callState: CallStateRepository,
    private readonly callUpdates: CallUpdatesService,
    private readonly metrics: MetricsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.attempts = config.get('recordings.uploadAttempts', { infer: true });
  }

  /** Non-blocking: queues the upload with retries + exponential backoff. */
  async enqueueUpload(callId: string): Promise<void> {
    await this.queue.add('upload', { callId } satisfies RecordingJobData, {
      jobId: `recording-${callId}`, // de-duplicates re-enqueues for the same call
      attempts: this.attempts,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }

  /** Uploads the (mock) recording and attaches it to the call. */
  async upload(callId: string, attempt: number): Promise<void> {
    const key = recordingKeyFor(callId);
    const url = await this.storage.upload(
      key,
      await this.loadRecording(),
      CONTENT_TYPE,
    );
    const result = await this.callState.append(
      callId,
      CallEventType.RECORDING_UPLOAD_SUCCEEDED,
      {
        fields: {
          recording_status: RecordingStatus.UPLOADED,
          recording_key: key,
          recording_url: url,
          recording_uploaded_at: Date.now(),
        },
        payload: { attempt, recording_key: key },
        snapshot: true, // persistence job writes the URL to the calls row
      },
    );
    await this.metrics.recordUpload('succeeded');
    await this.publish(result);
  }

  /** Records a failed attempt; on the final one the recording is marked FAILED. */
  async recordFailure(
    callId: string,
    attempt: number,
    error: Error,
    isFinalAttempt: boolean,
  ): Promise<void> {
    this.logger.warn(
      `Recording upload for ${callId} failed (attempt ${attempt}): ${error.message}`,
    );
    const result = await this.callState.append(
      callId,
      CallEventType.RECORDING_UPLOAD_FAILED,
      {
        fields: isFinalAttempt
          ? { recording_status: RecordingStatus.FAILED }
          : {},
        payload: { attempt, error: error.message, final: isFinalAttempt },
        snapshot: isFinalAttempt,
      },
    );
    if (isFinalAttempt) await this.metrics.recordUpload('failed');
    await this.publish(result);
  }

  private async publish(result: CallMutationResult): Promise<void> {
    if (result.applied) await this.callUpdates.publish(result.event);
  }

  /** The mock file is read once and reused for every upload. */
  private loadRecording(): Promise<Buffer> {
    this.recording ??= readFile(MOCK_RECORDING_PATH);
    return this.recording;
  }
}
