import { Job } from 'bullmq';
import { CallStatus } from '../../../common/call/call-status';
import { CallLifecycleService } from '../../call-lifecycle/call-lifecycle.service';
import { MockCallProcessor } from './mock-call.processor';
import { MockCallProvider, MockStepJobData } from './mock-call.provider';

describe('MockCallProcessor', () => {
  const lifecycle = { transition: jest.fn() };
  const provider = { scheduleNextStep: jest.fn() };
  const processor = new MockCallProcessor(
    lifecycle as unknown as CallLifecycleService,
    provider as unknown as MockCallProvider,
  );
  const job = {
    data: { callId: 'c1', from: CallStatus.QUEUED, to: CallStatus.RINGING },
  } as Job<MockStepJobData>;

  beforeEach(() => jest.clearAllMocks());

  it('applies the step and schedules the next one', async () => {
    lifecycle.transition.mockResolvedValue({ applied: true });
    await processor.process(job);
    expect(lifecycle.transition).toHaveBeenCalledWith(
      'c1',
      CallStatus.QUEUED,
      CallStatus.RINGING,
    );
    expect(provider.scheduleNextStep).toHaveBeenCalledWith(
      'c1',
      CallStatus.RINGING,
    );
  });

  it('still schedules the next step if this one was already applied (crash recovery)', async () => {
    lifecycle.transition.mockResolvedValue({
      applied: false,
      reason: 'CONFLICT',
      currentStatus: CallStatus.RINGING,
    });
    await processor.process(job);
    expect(provider.scheduleNextStep).toHaveBeenCalled();
  });

  it('stops when the call has moved elsewhere', async () => {
    lifecycle.transition.mockResolvedValue({
      applied: false,
      reason: 'CONFLICT',
      currentStatus: CallStatus.COMPLETED,
    });
    await processor.process(job);
    expect(provider.scheduleNextStep).not.toHaveBeenCalled();
  });
});
