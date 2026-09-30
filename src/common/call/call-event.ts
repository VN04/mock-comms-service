import { CallStatus } from './call-status';

/** Everything recorded in a call's audit trail (`call_events`). */
export enum CallEventType {
  CALL_CREATED = 'CALL_CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  /** A duplicate/stale transition was rejected by the compare-and-set. */
  TRANSITION_SKIPPED = 'TRANSITION_SKIPPED',
  RECORDING_UPLOAD_SUCCEEDED = 'RECORDING_UPLOAD_SUCCEEDED',
  RECORDING_UPLOAD_FAILED = 'RECORDING_UPLOAD_FAILED',
}

/** One entry of a call's lifecycle, as stored in Redis and MySQL. */
export interface CallEvent {
  callId: string;
  sequence: number;
  type: CallEventType;
  fromStatus: CallStatus | null;
  toStatus: CallStatus | null;
  payload: Record<string, unknown> | null;
  /** Epoch milliseconds when the event happened (not when it was persisted). */
  occurredAt: number;
}

/** Parses an event as serialized by the append-call-event Lua script. */
export function parseCallEvent(json: string): CallEvent {
  const raw = JSON.parse(json) as {
    callId: string;
    sequence: number;
    type: CallEventType;
    fromStatus?: string;
    toStatus?: string;
    payload?: Record<string, unknown>;
    occurredAt: number;
  };
  return {
    callId: raw.callId,
    sequence: raw.sequence,
    type: raw.type,
    fromStatus: (raw.fromStatus || null) as CallStatus | null,
    toStatus: (raw.toStatus || null) as CallStatus | null,
    payload: raw.payload ?? null,
    occurredAt: raw.occurredAt,
  };
}

/** Public (snake_case) shape of an event, used by the REST API and WebSocket. */
export interface CallEventResponse {
  call_id: string;
  sequence: number;
  type: CallEventType;
  from_status: CallStatus | null;
  to_status: CallStatus | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

export const toCallEventResponse = (e: CallEvent): CallEventResponse => ({
  call_id: e.callId,
  sequence: e.sequence,
  type: e.type,
  from_status: e.fromStatus,
  to_status: e.toStatus,
  payload: e.payload,
  occurred_at: new Date(e.occurredAt).toISOString(),
});
