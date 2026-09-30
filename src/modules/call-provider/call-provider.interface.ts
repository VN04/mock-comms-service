import { CallRecord } from '../../common/call/call-record';

/** DI token for the active CallProvider. */
export const CALL_PROVIDER = Symbol('CALL_PROVIDER');

/**
 * A telephony backend (mock simulator, Twilio, Plivo, …).
 *
 * Contract: `dial()` hands the call to the carrier and returns quickly
 * (no waiting for the call to progress). The provider then reports every
 * state change by calling `CallLifecycleService.transition()` — the mock does
 * this from delayed jobs; a real carrier would do it from a status webhook.
 *
 * Adding a provider = implement this interface + bind it in CallProviderModule.
 */
export interface CallProvider {
  /** Stored on the call record (e.g. 'mock', 'twilio'). */
  readonly name: string;
  dial(call: CallRecord): Promise<void>;
}
