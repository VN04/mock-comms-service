/**
 * Single source of truth for every Redis key / channel name.
 * The rate-limit keys share a `{apiKeyId}` hash tag so its Lua script stays
 * Cluster-compatible. Call scripts also touch global keys (event stream,
 * active set), so they assume a single Redis primary — fine for this service.
 */
export const RedisKeys = {
  /** Hash: live state of one call. */
  call: (callId: string) => `call:${callId}`,
  /** List: ordered lifecycle events of one call (hot copy of call_events). */
  callEvents: (callId: string) => `call:${callId}:events`,
  /** Set: WebSocket tokens issued for one call. */
  callWsTokens: (callId: string) => `call:${callId}:ws-tokens`,
  /** Stream: every call event, drained into MySQL by the persistence job. */
  eventStream: 'stream:call-events',
  /** Sorted set: IDs of all non-completed calls (score = queued_at). */
  activeCalls: 'calls:active',

  rateLimitActive: (apiKeyId: string) => `ratelimit:{${apiKeyId}}:active`,
  rateLimitCps: (apiKeyId: string) => `ratelimit:{${apiKeyId}}:cps`,

  apiKeyCache: (keyHash: string) => `apikey:${keyHash}`,
  idempotency: (apiKeyId: string, key: string) =>
    `idempotency:${apiKeyId}:${key}`,
  wsToken: (token: string) => `ws-token:${token}`,

  metrics: {
    callsTotal: 'metrics:calls:total',
    callsCreatedPerSecond: (epochSecond: number) =>
      `metrics:calls:created:${epochSecond}`,
    callsByApiKey: 'metrics:calls:by-api-key',
    callsCompleted: 'metrics:calls:completed',
    uploads: 'metrics:uploads',
    rateLimitRejections: 'metrics:rate-limit-rejections',
  },
} as const;

export const RedisChannels = {
  /** Pub/sub: call state changes fanned out to every API instance's WS clients. */
  callUpdates: 'channel:call-updates',
} as const;

/** Consumer group that drains the event stream into MySQL. */
export const EVENT_STREAM_GROUP = 'persistence';
