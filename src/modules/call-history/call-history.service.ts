import { Injectable } from '@nestjs/common';
import { ApiKeyContext } from '../../common/auth/api-key-context';
import {
  CallEventResponse,
  toCallEventResponse,
} from '../../common/call/call-event';
import { CallEventRepository } from '../../infrastructure/database/repositories/call-event.repository';
import { CallStateRepository } from '../../infrastructure/redis/repositories/call-state.repository';
import { CallsService } from '../calls/calls.service';

export interface CallHistoryResponse {
  call_id: string;
  events: CallEventResponse[];
}

/** A call's full lifecycle timeline, for debugging and client display. */
@Injectable()
export class CallHistoryService {
  constructor(
    private readonly calls: CallsService,
    private readonly callState: CallStateRepository,
    private readonly callEvents: CallEventRepository,
  ) {}

  /**
   * While a call is hot, Redis holds its complete, ordered event list (it is
   * written atomically with each state change), so there is no lag behind
   * the 5s MySQL flush. Afterwards the durable `call_events` rows are used.
   */
  async getHistory(
    apiKey: ApiKeyContext,
    callId: string,
  ): Promise<CallHistoryResponse> {
    await this.calls.findAccessible(apiKey, callId); // 404 if not visible
    const events =
      (await this.callState.getEvents(callId)) ??
      (await this.callEvents.findByCallId(callId));
    return { call_id: callId, events: events.map(toCallEventResponse) };
  }
}
