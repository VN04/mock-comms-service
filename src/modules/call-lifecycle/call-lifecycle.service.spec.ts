import { CallEventType } from '../../common/call/call-event';
import { CallStatus, RecordingStatus } from '../../common/call/call-status';
import { makeCall, makeEvent } from '../../common/testing/fixtures';
import { CallStateRepository } from '../../infrastructure/redis/repositories/call-state.repository';
import { CallUpdatesService } from '../call-updates/call-updates.service';
import { MetricsService } from '../metrics/metrics.service';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import { RecordingsService } from '../recordings/recordings.service';
import { CallLifecycleService } from './call-lifecycle.service';

describe('CallLifecycleService', () => {
  const callState = {
    transition: jest.fn(),
    append: jest.fn(),
    get: jest.fn(),
  };
  const callUpdates = { publish: jest.fn(), expireTokensForCall: jest.fn() };
  const rateLimiter = { release: jest.fn() };
  const recordings = { enqueueUpload: jest.fn() };
  const metrics = { recordCallCompleted: jest.fn() };
  let service: CallLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CallLifecycleService(
      callState as unknown as CallStateRepository,
      callUpdates as unknown as CallUpdatesService,
      rateLimiter as unknown as RateLimiterService,
      recordings as unknown as RecordingsService,
      metrics as unknown as MetricsService,
    );
  });

  it('rejects transitions outside the state machine', async () => {
    await expect(
      service.transition('c1', CallStatus.QUEUED, CallStatus.COMPLETED),
    ).rejects.toThrow('Illegal call transition');
    expect(callState.transition).not.toHaveBeenCalled();
  });

  it('applies an intermediate transition and publishes its event', async () => {
    const event = makeEvent({ type: CallEventType.STATUS_CHANGED });
    callState.transition.mockResolvedValue({
      applied: true,
      call: makeCall({ status: CallStatus.RINGING }),
      event,
    });

    await service.transition('c1', CallStatus.QUEUED, CallStatus.RINGING);

    expect(callState.transition).toHaveBeenCalledWith(
      'c1',
      CallStatus.QUEUED,
      CallStatus.RINGING,
      { fields: {} },
    );
    expect(callUpdates.publish).toHaveBeenCalledWith(event);
    expect(rateLimiter.release).not.toHaveBeenCalled();
    expect(recordings.enqueueUpload).not.toHaveBeenCalled();
  });

  it('on COMPLETED: frees the slot, queues the upload, shortens WS tokens', async () => {
    const call = makeCall({
      status: CallStatus.COMPLETED,
      outcome: CallStatus.ANSWERED,
    });
    callState.transition.mockResolvedValue({
      applied: true,
      call,
      event: makeEvent(),
    });

    await service.transition('c1', CallStatus.ANSWERED, CallStatus.COMPLETED);

    expect(callState.transition).toHaveBeenCalledWith(
      'c1',
      CallStatus.ANSWERED,
      CallStatus.COMPLETED,
      { fields: { recording_status: RecordingStatus.PENDING } },
    );
    expect(metrics.recordCallCompleted).toHaveBeenCalledWith(
      CallStatus.ANSWERED,
    );
    expect(rateLimiter.release).toHaveBeenCalledWith(call.apiKeyId, call.id);
    expect(recordings.enqueueUpload).toHaveBeenCalledWith(call.id);
    expect(callUpdates.expireTokensForCall).toHaveBeenCalledWith(call.id);
  });

  it('records a TRANSITION_SKIPPED event for a stale/duplicate job', async () => {
    callState.transition.mockResolvedValue({
      applied: false,
      reason: 'CONFLICT',
      currentStatus: CallStatus.ANSWERED,
    });

    const result = await service.transition(
      'c1',
      CallStatus.QUEUED,
      CallStatus.RINGING,
    );

    expect(result.applied).toBe(false);
    expect(callState.append).toHaveBeenCalledWith(
      'c1',
      CallEventType.TRANSITION_SKIPPED,
      {
        payload: {
          attempted_from: CallStatus.QUEUED,
          attempted_to: CallStatus.RINGING,
          current_status: CallStatus.ANSWERED,
        },
      },
    );
    expect(callUpdates.publish).not.toHaveBeenCalled();
  });

  it('re-runs completion follow-ups when a retried COMPLETED finds it already applied', async () => {
    const call = makeCall({ status: CallStatus.COMPLETED });
    callState.transition.mockResolvedValue({
      applied: false,
      reason: 'CONFLICT',
      currentStatus: CallStatus.COMPLETED,
    });
    callState.get.mockResolvedValue(call);

    await service.transition('c1', CallStatus.ANSWERED, CallStatus.COMPLETED);

    expect(rateLimiter.release).toHaveBeenCalledWith(call.apiKeyId, call.id);
    expect(recordings.enqueueUpload).toHaveBeenCalledWith(call.id);
    // Metrics are not double counted on the replay.
    expect(metrics.recordCallCompleted).not.toHaveBeenCalled();
  });
});
