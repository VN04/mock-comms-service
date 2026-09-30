import { Queue } from 'bullmq';
import { CallEventType } from '../../common/call/call-event';
import { RecordingStatus } from '../../common/call/call-status';
import { makeCall, makeEvent, mockConfig } from '../../common/testing/fixtures';
import { CallStateRepository } from '../../infrastructure/redis/repositories/call-state.repository';
import { CallUpdatesService } from '../call-updates/call-updates.service';
import { MetricsService } from '../metrics/metrics.service';
import { RecordingsService } from './recordings.service';

describe('RecordingsService', () => {
  const queue = { add: jest.fn() };
  const storage = { upload: jest.fn(), getSignedDownloadUrl: jest.fn() };
  const callState = { append: jest.fn() };
  const callUpdates = { publish: jest.fn() };
  const metrics = { recordUpload: jest.fn() };
  let service: RecordingsService;
  const event = makeEvent({ type: CallEventType.RECORDING_UPLOAD_SUCCEEDED });

  beforeEach(() => {
    jest.clearAllMocks();
    callState.append.mockResolvedValue({
      applied: true,
      call: makeCall(),
      event,
    });
    service = new RecordingsService(
      queue as unknown as Queue,
      storage,
      callState as unknown as CallStateRepository,
      callUpdates as unknown as CallUpdatesService,
      metrics as unknown as MetricsService,
      mockConfig({ recordings: { uploadAttempts: 5 } }),
    );
  });

  it('enqueues one de-duplicated upload job with retries/backoff', async () => {
    await service.enqueueUpload('c1');
    expect(queue.add).toHaveBeenCalledWith(
      'upload',
      { callId: 'c1' },
      {
        jobId: 'recording-c1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
  });

  it('uploads the mock file and attaches the URL to the call', async () => {
    storage.upload.mockResolvedValue(
      'http://minio/recordings/recordings/c1.mp3',
    );

    await service.upload('c1', 1);

    const [key, body, contentType] = storage.upload.mock.calls[0] as [
      string,
      Buffer,
      string,
    ];
    expect(key).toBe('recordings/c1.mp3');
    expect(body.length).toBeGreaterThan(0); // real assets/mock_recording.mp3
    expect(contentType).toBe('audio/mpeg');
    expect(callState.append).toHaveBeenCalledWith(
      'c1',
      CallEventType.RECORDING_UPLOAD_SUCCEEDED,
      expect.objectContaining({
        fields: expect.objectContaining({
          recording_status: RecordingStatus.UPLOADED,
          recording_key: 'recordings/c1.mp3',
          recording_url: 'http://minio/recordings/recordings/c1.mp3',
        }) as object,
        snapshot: true,
      }),
    );
    expect(metrics.recordUpload).toHaveBeenCalledWith('succeeded');
    expect(callUpdates.publish).toHaveBeenCalledWith(event);
  });

  it('records a retryable failure without marking the recording FAILED', async () => {
    await service.recordFailure('c1', 1, new Error('timeout'), false);
    expect(callState.append).toHaveBeenCalledWith(
      'c1',
      CallEventType.RECORDING_UPLOAD_FAILED,
      {
        fields: {},
        payload: { attempt: 1, error: 'timeout', final: false },
        snapshot: false,
      },
    );
    expect(metrics.recordUpload).not.toHaveBeenCalled();
  });

  it('marks the recording FAILED after the final attempt', async () => {
    await service.recordFailure('c1', 5, new Error('timeout'), true);
    expect(callState.append).toHaveBeenCalledWith(
      'c1',
      CallEventType.RECORDING_UPLOAD_FAILED,
      expect.objectContaining({
        fields: { recording_status: RecordingStatus.FAILED },
        snapshot: true,
      }),
    );
    expect(metrics.recordUpload).toHaveBeenCalledWith('failed');
  });
});
