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
            queuedDelayMs: { min: 100, max: 200 },
            ringingDelayMs: { min: 300, max: 400 },
            talkDurationMs: { min: 1000, max: 2000 },
            unansweredDelayMs: { min: 500, max: 600 },
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
    const step = build(1).planNextStep(CallStatus.RINGING);
    expect(step?.to).toBe(CallStatus.ANSWERED);
    expect(step?.delayMs).toBeGreaterThanOrEqual(300);
    expect(step?.delayMs).toBeLessThanOrEqual(400);
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
    const step = provider.planNextStep(CallStatus.UNANSWERED);
    expect(step?.to).toBe(CallStatus.COMPLETED);
    expect(step?.delayMs).toBeGreaterThanOrEqual(500);
    expect(step?.delayMs).toBeLessThanOrEqual(600);
    expect(provider.planNextStep(CallStatus.COMPLETED)).toBeNull();

    await provider.scheduleNextStep('c1', CallStatus.COMPLETED);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
