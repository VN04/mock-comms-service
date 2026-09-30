import { CallEventType } from '../../../common/call/call-event';
import { newCallHash } from '../../../common/call/call-record';
import { CallStatus } from '../../../common/call/call-status';
import { makeCall, mockConfig } from '../../../common/testing/fixtures';
import { RedisService } from '../redis.service';
import { CallStateRepository } from './call-state.repository';

/** Script ARGV positions (see append-call-event.lua). */
const ARG = {
  mode: 0,
  from: 3,
  to: 4,
  fields: 5,
  snapshot: 8,
  finalizeTtl: 10,
};

describe('CallStateRepository', () => {
  const redis = { runScript: jest.fn() };
  const repo = new CallStateRepository(
    redis as unknown as RedisService,
    mockConfig({
      callState: { eventStreamMaxLength: 1000, ttlSeconds: 3600 },
    }),
  );
  const args = () => redis.runScript.mock.calls[0][2] as (string | number)[];
  const eventJson = JSON.stringify({
    callId: 'c1',
    sequence: 2,
    type: CallEventType.STATUS_CHANGED,
    fromStatus: 'QUEUED',
    toStatus: 'RINGING',
    occurredAt: 1,
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates a call with a snapshot so the calls row gets inserted', async () => {
    const call = makeCall();
    redis.runScript.mockResolvedValue([
      1,
      1,
      JSON.stringify({ ...newCallHash(call), seq: '1' }),
      eventJson,
    ]);

    const result = await repo.create(call);

    expect(result.applied).toBe(true);
    expect(args()[ARG.mode]).toBe('create');
    expect(args()[ARG.to]).toBe(CallStatus.QUEUED);
    expect(args()[ARG.snapshot]).toBe('1');
    expect(args()[ARG.finalizeTtl]).toBe(0);
  });

  it('transition() sets status, its timestamp and the outcome', async () => {
    redis.runScript.mockResolvedValue([0, 'CONFLICT', 'ANSWERED']);

    await repo.transition('c1', CallStatus.RINGING, CallStatus.ANSWERED, {
      occurredAt: 123,
    });

    expect(args()[ARG.mode]).toBe('transition');
    expect(args()[ARG.from]).toBe(CallStatus.RINGING);
    expect(JSON.parse(args()[ARG.fields] as string)).toEqual({
      status: 'ANSWERED',
      answered_at: '123',
      outcome: 'ANSWERED',
    });
    expect(args()[ARG.snapshot]).toBe('0'); // intermediate: no calls-row write
  });

  it('finalizes (snapshot + TTL) when reaching COMPLETED', async () => {
    redis.runScript.mockResolvedValue([0, 'NOT_FOUND']);
    await repo.transition('c1', CallStatus.ANSWERED, CallStatus.COMPLETED);
    expect(args()[ARG.snapshot]).toBe('1');
    expect(args()[ARG.finalizeTtl]).toBe(3600);
  });

  it('maps a CAS conflict to a non-applied result', async () => {
    redis.runScript.mockResolvedValue([0, 'CONFLICT', 'COMPLETED']);
    await expect(
      repo.transition('c1', CallStatus.QUEUED, CallStatus.RINGING),
    ).resolves.toEqual({
      applied: false,
      reason: 'CONFLICT',
      currentStatus: 'COMPLETED',
    });
  });
});
