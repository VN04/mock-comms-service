import { parseCallEvent, CallEventType } from './call-event';
import { callFromHash, newCallHash } from './call-record';
import { CallStatus, isValidTransition } from './call-status';
import { makeCall } from '../testing/fixtures';

describe('call state machine', () => {
  it.each([
    [CallStatus.QUEUED, CallStatus.RINGING],
    [CallStatus.RINGING, CallStatus.ANSWERED],
    [CallStatus.RINGING, CallStatus.UNANSWERED],
    [CallStatus.ANSWERED, CallStatus.COMPLETED],
    [CallStatus.UNANSWERED, CallStatus.COMPLETED],
  ])('allows %s → %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it.each([
    [CallStatus.QUEUED, CallStatus.ANSWERED],
    [CallStatus.RINGING, CallStatus.COMPLETED],
    [CallStatus.COMPLETED, CallStatus.RINGING],
    [CallStatus.ANSWERED, CallStatus.RINGING],
  ])('rejects %s → %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
  });
});

describe('call hash mapping', () => {
  it('round-trips a new call through its Redis hash', () => {
    const call = makeCall({ metadata: { order: 42 }, lastSequence: null });
    const restored = callFromHash(newCallHash(call));
    expect(restored).toEqual(call);
  });

  it('parses per-status timestamps and sequence', () => {
    const hash = {
      ...newCallHash(makeCall()),
      status: CallStatus.COMPLETED,
      outcome: CallStatus.ANSWERED,
      ringing_at: '1700000001000',
      answered_at: '1700000002000',
      completed_at: '1700000003000',
      seq: '4',
    };
    expect(callFromHash(hash)).toMatchObject({
      status: CallStatus.COMPLETED,
      outcome: CallStatus.ANSWERED,
      ringingAt: 1700000001000,
      answeredAt: 1700000002000,
      unansweredAt: null,
      completedAt: 1700000003000,
      lastSequence: 4,
    });
  });

  it('returns null for a missing hash', () => {
    expect(callFromHash({})).toBeNull();
  });
});

describe('parseCallEvent', () => {
  it('maps empty statuses and missing payload to null', () => {
    const event = parseCallEvent(
      JSON.stringify({
        callId: 'c1',
        sequence: 5,
        type: CallEventType.RECORDING_UPLOAD_SUCCEEDED,
        fromStatus: '',
        toStatus: '',
        occurredAt: 1,
      }),
    );
    expect(event).toEqual({
      callId: 'c1',
      sequence: 5,
      type: CallEventType.RECORDING_UPLOAD_SUCCEEDED,
      fromStatus: null,
      toStatus: null,
      payload: null,
      occurredAt: 1,
    });
  });
});
