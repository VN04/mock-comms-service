import { NotFoundException } from '@nestjs/common';
import { makeApiKey, makeCall, makeEvent } from '../../common/testing/fixtures';
import { CallEventRepository } from '../../infrastructure/database/repositories/call-event.repository';
import { CallStateRepository } from '../../infrastructure/redis/repositories/call-state.repository';
import { CallsService } from '../calls/calls.service';
import { CallHistoryService } from './call-history.service';

describe('CallHistoryService', () => {
  const calls = { findAccessible: jest.fn() };
  const callState = { getEvents: jest.fn() };
  const callEvents = { findByCallId: jest.fn() };
  const service = new CallHistoryService(
    calls as unknown as CallsService,
    callState as unknown as CallStateRepository,
    callEvents as unknown as CallEventRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    calls.findAccessible.mockResolvedValue(makeCall());
  });

  it('serves the hot event list from Redis', async () => {
    callState.getEvents.mockResolvedValue([makeEvent()]);

    const res = await service.getHistory(makeApiKey(), 'c1');

    expect(res.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: 'CALL_CREATED',
        to_status: 'QUEUED',
        occurred_at: new Date(1_700_000_000_000).toISOString(),
      }),
    ]);
    expect(callEvents.findByCallId).not.toHaveBeenCalled();
  });

  it('falls back to MySQL once the call left Redis', async () => {
    callState.getEvents.mockResolvedValue(null);
    callEvents.findByCallId.mockResolvedValue([
      makeEvent(),
      makeEvent({ sequence: 2 }),
    ]);

    const res = await service.getHistory(makeApiKey(), 'c1');
    expect(res.events.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('enforces call visibility first', async () => {
    calls.findAccessible.mockRejectedValue(new NotFoundException());
    await expect(service.getHistory(makeApiKey(), 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(callState.getEvents).not.toHaveBeenCalled();
  });
});
