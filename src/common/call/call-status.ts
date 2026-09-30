/** Every state a call can be in. Stored as-is in Redis and MySQL. */
export enum CallStatus {
  QUEUED = 'QUEUED',
  RINGING = 'RINGING',
  ANSWERED = 'ANSWERED',
  UNANSWERED = 'UNANSWERED',
  COMPLETED = 'COMPLETED',
}

/** How a call ended — the branch it took before COMPLETED. */
export type CallOutcome = CallStatus.ANSWERED | CallStatus.UNANSWERED;

/**
 * The call state machine: the only transitions any provider may apply.
 * `QUEUED → RINGING → (ANSWERED | UNANSWERED) → COMPLETED`
 */
export const CALL_TRANSITIONS: Readonly<
  Record<CallStatus, readonly CallStatus[]>
> = {
  [CallStatus.QUEUED]: [CallStatus.RINGING],
  [CallStatus.RINGING]: [CallStatus.ANSWERED, CallStatus.UNANSWERED],
  [CallStatus.ANSWERED]: [CallStatus.COMPLETED],
  [CallStatus.UNANSWERED]: [CallStatus.COMPLETED],
  [CallStatus.COMPLETED]: [],
};

export const isValidTransition = (from: CallStatus, to: CallStatus): boolean =>
  CALL_TRANSITIONS[from].includes(to);

export const isOutcome = (status: CallStatus): status is CallOutcome =>
  status === CallStatus.ANSWERED || status === CallStatus.UNANSWERED;

/** Name of the per-status timestamp field, e.g. RINGING → `ringing_at`. */
export const statusTimestampField = (status: CallStatus): string =>
  `${status.toLowerCase()}_at`;

export enum RecordingStatus {
  PENDING = 'PENDING',
  UPLOADED = 'UPLOADED',
  FAILED = 'FAILED',
}
