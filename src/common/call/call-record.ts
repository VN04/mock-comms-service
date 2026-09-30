import {
  CallOutcome,
  CallStatus,
  RecordingStatus,
  statusTimestampField,
} from './call-status';

/**
 * The canonical in-memory shape of a call, independent of storage.
 * Timestamps are epoch milliseconds.
 */
export interface CallRecord {
  id: string;
  apiKeyId: string;
  from: string;
  to: string;
  metadata: Record<string, unknown> | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  provider: string;
  queuedAt: number;
  ringingAt: number | null;
  answeredAt: number | null;
  unansweredAt: number | null;
  completedAt: number | null;
  recordingStatus: RecordingStatus | null;
  recordingKey: string | null;
  /** Canonical (unsigned) object URL. Clients get a short-lived signed URL instead. */
  recordingUrl: string | null;
  recordingUploadedAt: number | null;
  updatedAt: number;
  /** Sequence of the latest event (lets WS clients order snapshot vs. events). Null when loaded from MySQL. */
  lastSequence: number | null;
}

/** Redis hash representation: flat string fields, snake_case (mirrors DB columns). */
export type CallHash = Record<string, string>;

const num = (v: string | undefined): number | null =>
  v === undefined || v === '' ? null : Number(v);
const str = (v: string | undefined): string | null =>
  v === undefined || v === '' ? null : v;

/** Converts a Redis hash (or a Lua snapshot) into a CallRecord. */
export function callFromHash(hash: CallHash): CallRecord | null {
  if (!hash || !hash.id) return null;
  return {
    id: hash.id,
    apiKeyId: hash.api_key_id,
    from: hash.from_number,
    to: hash.to_number,
    metadata: hash.metadata
      ? (JSON.parse(hash.metadata) as Record<string, unknown>)
      : null,
    status: hash.status as CallStatus,
    outcome: str(hash.outcome) as CallOutcome | null,
    provider: hash.provider,
    queuedAt: Number(hash.queued_at),
    ringingAt: num(hash[statusTimestampField(CallStatus.RINGING)]),
    answeredAt: num(hash[statusTimestampField(CallStatus.ANSWERED)]),
    unansweredAt: num(hash[statusTimestampField(CallStatus.UNANSWERED)]),
    completedAt: num(hash[statusTimestampField(CallStatus.COMPLETED)]),
    recordingStatus: str(hash.recording_status) as RecordingStatus | null,
    recordingKey: str(hash.recording_key),
    recordingUrl: str(hash.recording_url),
    recordingUploadedAt: num(hash.recording_uploaded_at),
    updatedAt: Number(hash.updated_at),
    lastSequence: num(hash.seq),
  };
}

/** Initial hash for a brand-new call (only non-null fields are written). */
export function newCallHash(call: CallRecord): CallHash {
  return {
    id: call.id,
    api_key_id: call.apiKeyId,
    from_number: call.from,
    to_number: call.to,
    metadata: call.metadata ? JSON.stringify(call.metadata) : '',
    status: call.status,
    provider: call.provider,
    queued_at: String(call.queuedAt),
    updated_at: String(call.updatedAt),
  };
}
