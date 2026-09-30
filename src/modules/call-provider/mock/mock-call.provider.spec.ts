import { Queue } from 'bullmq';
import { CallStatus } from '../../../common/call/call-status';
import { makeCall, mockConfig } from '../../../common/testing/fixtures';
import { MockCallProvider } from './mock-call.provider';

describe('MockCallProvider', () => {
  const queue = { add: jest.fn() };
  const build = (answerProbability: number) =>
    new MockCallProvider(
      queue as unknown as Queue,
      mockConfig({
        callProvider: {
          mock: {
            stepDelayMinMs: 100,
            stepDelayMaxMs: 200,
            talkDurationMinMs: 1000,
            talkDurationMaxMs: 2000,
            answerProbability,
          },
        },
      }),
    );

  beforeEach(() => jest.clearAllMocks());

  it('dial() schedules QUEUED → RINGING as a delayed, de-duplicated job', async () => {
    const call = makeCall();
    await build(0.5).dial(call);

    expect(queue.add).toHaveBeenCalledWith(
      'step',
      { callId: call.id, from: CallStatus.QUEUED, to: CallStatus.RINGING },
      expect.objectContaining({ jobId: `${call.id}-RINGING`, attempts: 5 }),
    );
    const { delay } = queue.add.mock.calls[0][2] as { delay: number };
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(200);
  });

  it('branches RINGING → ANSWERED or UNANSWERED by probability', () => {
    expect(build(1).planNextStep(CallStatus.RINGING)?.to).toBe(
      CallStatus.ANSWERED,
    );
    expect(build(0).planNextStep(CallStatus.RINGING)?.to).toBe(
      CallStatus.UNANSWERED,
    );
  });

  it('holds answered calls for the talk duration before completing', () => {
    const step = build(1).planNextStep(CallStatus.ANSWERED);
    expect(step?.to).toBe(CallStatus.COMPLETED);
    expect(step?.delayMs).toBeGreaterThanOrEqual(1000);
    expect(step?.delayMs).toBeLessThanOrEqual(2000);
  });

  it('completes unanswered calls and stops after COMPLETED', async () => {
    const provider = build(0.5);
    expect(provider.planNextStep(CallStatus.UNANSWERED)?.to).toBe(
      CallStatus.COMPLETED,
    );
    expect(provider.planNextStep(CallStatus.COMPLETED)).toBeNull();

    await provider.scheduleNextStep('c1', CallStatus.COMPLETED);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
