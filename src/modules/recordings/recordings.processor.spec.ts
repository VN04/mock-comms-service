import { Job } from 'bullmq';
import { RecordingsProcessor } from './recordings.processor';
import { RecordingJobData, RecordingsService } from './recordings.service';

describe('RecordingsProcessor', () => {
  const recordings = { upload: jest.fn(), recordFailure: jest.fn() };
  const processor = new RecordingsProcessor(
    recordings as unknown as RecordingsService,
  );
  const job = (attemptsMade: number) =>
    ({
      data: { callId: 'c1' },
      attemptsMade,
      opts: { attempts: 3 },
    }) as Job<RecordingJobData>;

  beforeEach(() => jest.clearAllMocks());

  it('uploads with a 1-based attempt number', async () => {
    await processor.process(job(0));
    expect(recordings.upload).toHaveBeenCalledWith('c1', 1);
  });

  it('records the failure and rethrows so BullMQ retries', async () => {
    const error = new Error('S3 down');
    recordings.upload.mockRejectedValueOnce(error);

    await expect(processor.process(job(0))).rejects.toBe(error);
    expect(recordings.recordFailure).toHaveBeenCalledWith(
      'c1',
      1,
      error,
      false,
    );
  });

  it('flags the last attempt as final', async () => {
    recordings.upload.mockRejectedValueOnce(new Error('S3 down'));
    await expect(processor.process(job(2))).rejects.toBeDefined();
    expect(recordings.recordFailure).toHaveBeenCalledWith(
      'c1',
      3,
      expect.any(Error),
      true,
    );
  });
});
