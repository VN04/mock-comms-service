import { Injectable, Logger } from '@nestjs/common';
import { CallEventType } from '../../common/call/call-event';
import { CallRecord } from '../../common/call/call-record';
import {
  CallStatus,
  isValidTransition,
  RecordingStatus,
} from '../../common/call/call-status';
import {
  CallMutationResult,
  CallStateRepository,
} from '../../infrastructure/redis/repositories/call-state.repository';
import { CallUpdatesService } from '../call-updates/call-updates.service';
import { MetricsService } from '../metrics/metrics.service';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import { RecordingsService } from '../recordings/recordings.service';

/**
 * Provider-agnostic state machine driver. Any provider (mock scheduler, real
 * carrier webhooks…) reports progress by calling `transition()`; everything
 * that must happen on a state change lives here, in one place.
 */
@Injectable()
export class CallLifecycleService {
  private readonly logger = new Logger(CallLifecycleService.name);

  constructor(
    private readonly callState: CallStateRepository,
    private readonly callUpdates: CallUpdatesService,
    private readonly rateLimiter: RateLimiterService,
    private readonly recordings: RecordingsService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Applies `from → to` with compare-and-set semantics. Safe to call more
   * than once (at-least-once job delivery): a duplicate is skipped and logged.
   */
  async transition(
    callId: string,
    from: CallStatus,
    to: CallStatus,
  ): Promise<CallMutationResult> {
    if (!isValidTransition(from, to)) {
      throw new Error(`Illegal call transition ${from} → ${to}`);
    }

    const isFinal = to === CallStatus.COMPLETED;
    const result = await this.callState.transition(callId, from, to, {
      fields: isFinal ? { recording_status: RecordingStatus.PENDING } : {},
    });

    if (result.applied) {
      await this.callUpdates.publish(result.event);
      if (isFinal) {
        await this.metrics.recordCallCompleted(result.call.outcome);
        await this.onCompleted(result.call);
      }
      return result;
    }

    if (result.reason === 'CONFLICT') {
      await this.callState.append(callId, CallEventType.TRANSITION_SKIPPED, {
        payload: {
          attempted_from: from,
          attempted_to: to,
          current_status: result.currentStatus ?? null,
        },
      });
      // A retry after a crash mid-follow-up: the state already moved, but the
      // follow-ups may not have run. They are idempotent, so run them again.
      if (isFinal && result.currentStatus === CallStatus.COMPLETED) {
        const call = await this.callState.get(callId);
        if (call) await this.onCompleted(call);
      }
    }
    this.logger.warn(
      `Skipped ${from} → ${to} for call ${callId}: ${result.reason}` +
        (result.currentStatus ? ` (current: ${result.currentStatus})` : ''),
    );
    return result;
  }

  /** Idempotent follow-ups of a completed call. */
  private async onCompleted(call: CallRecord): Promise<void> {
    await Promise.all([
      this.rateLimiter.release(call.apiKeyId, call.id),
      this.recordings.enqueueUpload(call.id),
      this.callUpdates.expireTokensForCall(call.id),
    ]);
  }
}
