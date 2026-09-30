import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CallEvent,
  CallEventType,
  parseCallEvent,
} from '../../../common/call/call-event';
import {
  CallHash,
  CallRecord,
  callFromHash,
  newCallHash,
} from '../../../common/call/call-record';
import {
  CallStatus,
  isOutcome,
  statusTimestampField,
} from '../../../common/call/call-status';
import { RedisKeys } from '../../../common/constants/redis-keys';
import { AppConfig } from '../../../config/configuration';
import { APPEND_CALL_EVENT_LUA } from '../lua/append-call-event.lua';
import { LuaScript, RedisService } from '../redis.service';

const APPEND_CALL_EVENT: LuaScript = {
  name: 'appendCallEvent',
  lua: APPEND_CALL_EVENT_LUA,
  numberOfKeys: 5,
};

type Mode = 'create' | 'transition' | 'append';
type ScriptReply =
  | [0, 'EXISTS' | 'NOT_FOUND' | 'CONFLICT', string?]
  | [1, number, string, string];

export type CallMutationResult =
  | { applied: true; call: CallRecord; event: CallEvent }
  | {
      applied: false;
      reason: 'EXISTS' | 'NOT_FOUND' | 'CONFLICT';
      currentStatus?: CallStatus;
    };

export interface AppendOptions {
  /** Hash fields to set alongside the event. */
  fields?: Record<string, string | number>;
  payload?: Record<string, unknown>;
  /** Attach a full state snapshot so the persistence job upserts the `calls` row. */
  snapshot?: boolean;
  occurredAt?: number;
}

/**
 * Redis-backed store for LIVE call state and its event log.
 * Every mutation goes through one atomic Lua script (see append-call-event.lua).
 */
@Injectable()
export class CallStateRepository {
  private readonly streamMaxLength: number;
  private readonly completedTtlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.streamMaxLength = config.get('callState.eventStreamMaxLength', {
      infer: true,
    });
    this.completedTtlSeconds = config.get('callState.ttlSeconds', {
      infer: true,
    });
  }

  /** Stores a new QUEUED call and records CALL_CREATED. */
  create(call: CallRecord): Promise<CallMutationResult> {
    return this.mutate('create', call.id, CallEventType.CALL_CREATED, {
      to: CallStatus.QUEUED,
      fields: newCallHash(call),
      snapshot: true,
      occurredAt: call.queuedAt,
    });
  }

  /**
   * Compare-and-set transition: applied only if the call is currently `from`.
   * Reaching COMPLETED finalizes the call (leaves the active set, keys get a TTL).
   */
  transition(
    callId: string,
    from: CallStatus,
    to: CallStatus,
    options: AppendOptions = {},
  ): Promise<CallMutationResult> {
    const occurredAt = options.occurredAt ?? Date.now();
    const isFinal = to === CallStatus.COMPLETED;
    return this.mutate('transition', callId, CallEventType.STATUS_CHANGED, {
      ...options,
      from,
      to,
      occurredAt,
      snapshot: options.snapshot ?? isFinal,
      finalize: isFinal,
      fields: {
        ...options.fields,
        status: to,
        [statusTimestampField(to)]: occurredAt,
        ...(isOutcome(to) ? { outcome: to } : {}),
      },
    });
  }

  /** Records a non-transition event (e.g. recording uploaded) on an existing call. */
  append(
    callId: string,
    type: CallEventType,
    options: AppendOptions = {},
  ): Promise<CallMutationResult> {
    return this.mutate('append', callId, type, options);
  }

  async get(callId: string): Promise<CallRecord | null> {
    const hash = await this.redis.client.hgetall(RedisKeys.call(callId));
    return callFromHash(hash);
  }

  /** Full ordered event list while the call is hot in Redis, otherwise null. */
  async getEvents(callId: string): Promise<CallEvent[] | null> {
    const raw = await this.redis.client.lrange(
      RedisKeys.callEvents(callId),
      0,
      -1,
    );
    return raw.length ? raw.map(parseCallEvent) : null;
  }

  private async mutate(
    mode: Mode,
    callId: string,
    type: CallEventType,
    opts: AppendOptions & {
      from?: CallStatus;
      to?: CallStatus;
      finalize?: boolean;
    },
  ): Promise<CallMutationResult> {
    const reply = await this.redis.runScript<ScriptReply>(
      APPEND_CALL_EVENT,
      [
        RedisKeys.call(callId),
        RedisKeys.callEvents(callId),
        RedisKeys.eventStream,
        RedisKeys.activeCalls,
        RedisKeys.metrics.callsTotal,
      ],
      [
        mode,
        callId,
        type,
        opts.from ?? '',
        opts.to ?? '',
        JSON.stringify(stringifyValues(opts.fields ?? {})),
        opts.payload ? JSON.stringify(opts.payload) : '',
        opts.occurredAt ?? Date.now(),
        opts.snapshot ? '1' : '0',
        this.streamMaxLength,
        opts.finalize ? this.completedTtlSeconds : 0,
      ],
    );

    if (reply[0] === 1) {
      const call = callFromHash(JSON.parse(reply[2]) as CallHash);
      return { applied: true, call: call!, event: parseCallEvent(reply[3]) };
    }
    return {
      applied: false,
      reason: reply[1],
      currentStatus: (reply[2] as CallStatus | undefined) ?? undefined,
    };
  }
}

const stringifyValues = (
  fields: Record<string, string | number>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]));
