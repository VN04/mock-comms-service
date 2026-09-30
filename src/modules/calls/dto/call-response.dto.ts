import {
  CallOutcome,
  CallStatus,
  RecordingStatus,
} from '../../../common/call/call-status';

export interface CallResponse {
  call_id: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  from: string;
  to: string;
  metadata: Record<string, unknown> | null;
  provider: string;
  timestamps: {
    queued_at: string;
    ringing_at: string | null;
    answered_at: string | null;
    unanswered_at: string | null;
    completed_at: string | null;
  };
  recording: {
    status: RecordingStatus;
    /** Short-lived signed download URL (null until uploaded). */
    url: string | null;
    url_expires_at: string | null;
  } | null;
  /** Sequence of the latest event; lets WebSocket clients de-duplicate. */
  last_event_sequence: number | null;
}

export interface CreateCallResponse {
  call_id: string;
  status: CallStatus;
  /** Connect here for real-time updates (token is scoped to this call only). */
  ws_url: string;
  ws_token_expires_at: string;
}

export interface WsTokenResponse {
  ws_url: string;
  ws_token_expires_at: string;
}
