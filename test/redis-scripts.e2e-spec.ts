/**
 * Integration tests for the Lua scripts against a REAL Redis — the only way
 * to prove the atomicity guarantees under concurrency.
 *
 *   docker compose up -d redis
 *   pnpm test:e2e
 *
 * Uses DB 15 of REDIS_TEST_URL (default redis://localhost:6380/15) and
 * flushes it before each test.
 */
import { CallEventType } from '../src/common/call/call-event';
import { CallStatus } from '../src/common/call/call-status';
import { RedisKeys } from '../src/common/constants/redis-keys';
import {
  makeApiKey,
  makeCall,
  mockConfig,
} from '../src/common/testing/fixtures';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { CallStateRepository } from '../src/infrastructure/redis/repositories/call-state.repository';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { RateLimiterService } from '../src/modules/rate-limiter/rate-limiter.service';

const REDIS_URL = process.env.REDIS_TEST_URL ?? 'redis://localhost:6380/15';

describe('Redis Lua scripts (integration)', () => {
  const config = mockConfig({
    redis: { url: REDIS_URL },
    rateLimit: { staleSlotMs: 600000 },
    callState: { eventStreamMaxLength: 10000, ttlSeconds: 3600 },
  });
  const redis = new RedisService(config);
  const metrics = { recordRateLimitRejection: jest.fn() };
  const rateLimiter = new RateLimiterService(
    redis,
    metrics as unknown as MetricsService,
    config,
  );
  const callState = new CallStateRepository(redis, config);

  beforeEach(() => redis.client.flushdb());
  afterAll(() => redis.onApplicationShutdown());

  /** Fires `n` reservations at once; returns how many were accepted. */
  const burst = async (
    n: number,
    limits: { concurrent: number; cps: number },
  ) => {
    const apiKey = makeApiKey({
      maxConcurrentCalls: limits.concurrent,
      maxCps: limits.cps,
    });
    const results = await Promise.allSettled(
      Array.from({ length: n }, (_, i) =>
        rateLimiter.reserve(apiKey, `call-${i}`),
      ),
    );
    return results.filter((r) => r.status === 'fulfilled').length;
  };

  describe('reserve-call-slot', () => {
    it('never admits more than the concurrency limit, even when requests race', async () => {
      await expect(burst(50, { concurrent: 3, cps: 1000 })).resolves.toBe(3);
    });

    it('never admits more than the CPS limit within one second', async () => {
      await expect(burst(50, { concurrent: 1000, cps: 2 })).resolves.toBe(2);
    });

    it('a CPS rejection does not consume a concurrency slot', async () => {
      await burst(10, { concurrent: 5, cps: 2 });
      await expect(
        redis.client.zcard(RedisKeys.rateLimitActive('key-1')),
      ).resolves.toBe(2);
    });

    it('slides the CPS window: capacity returns after one second', async () => {
      await expect(burst(5, { concurrent: 100, cps: 2 })).resolves.toBe(2);
      await new Promise((r) => setTimeout(r, 1050));
      await expect(burst(5, { concurrent: 100, cps: 2 })).resolves.toBe(2);
    });

    it('releasing a slot makes room for a new call', async () => {
      const apiKey = makeApiKey({ maxConcurrentCalls: 1, maxCps: 100 });
      await rateLimiter.reserve(apiKey, 'a');
      await expect(rateLimiter.reserve(apiKey, 'b')).rejects.toThrow();
      await rateLimiter.release(apiKey.id, 'a');
      await expect(rateLimiter.reserve(apiKey, 'b')).resolves.toBeUndefined();
    });
  });

  describe('append-call-event', () => {
    const call = makeCall();

    it('records the full lifecycle with gap-free sequence numbers', async () => {
      await callState.create(call);
      await callState.transition(
        call.id,
        CallStatus.QUEUED,
        CallStatus.RINGING,
      );
      await callState.transition(
        call.id,
        CallStatus.RINGING,
        CallStatus.ANSWERED,
      );
      const done = await callState.transition(
        call.id,
        CallStatus.ANSWERED,
        CallStatus.COMPLETED,
      );

      expect(done.applied && done.call).toMatchObject({
        status: CallStatus.COMPLETED,
        outcome: CallStatus.ANSWERED,
        lastSequence: 4,
      });
      const events = await callState.getEvents(call.id);
      expect(events?.map((e) => [e.sequence, e.type, e.toStatus])).toEqual([
        [1, CallEventType.CALL_CREATED, CallStatus.QUEUED],
        [2, CallEventType.STATUS_CHANGED, CallStatus.RINGING],
        [3, CallEventType.STATUS_CHANGED, CallStatus.ANSWERED],
        [4, CallEventType.STATUS_CHANGED, CallStatus.COMPLETED],
      ]);
    });

    it('compare-and-set: of many racing duplicates exactly one applies', async () => {
      await callState.create(call);
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          callState.transition(call.id, CallStatus.QUEUED, CallStatus.RINGING),
        ),
      );
      expect(results.filter((r) => r.applied)).toHaveLength(1);
      expect(results.filter((r) => !r.applied)[0]).toEqual({
        applied: false,
        reason: 'CONFLICT',
        currentStatus: CallStatus.RINGING,
      });
    });

    it('a stale job cannot move a call backwards', async () => {
      await callState.create(call);
      await callState.transition(
        call.id,
        CallStatus.QUEUED,
        CallStatus.RINGING,
      );
      await callState.transition(
        call.id,
        CallStatus.RINGING,
        CallStatus.UNANSWERED,
      );

      const stale = await callState.transition(
        call.id,
        CallStatus.QUEUED,
        CallStatus.RINGING,
      );
      expect(stale.applied).toBe(false);
      await expect(callState.get(call.id)).resolves.toMatchObject({
        status: CallStatus.UNANSWERED,
      });
    });

    it('maintains the active set, total counter and stream; completion expires keys', async () => {
      await callState.create(call);
      await expect(redis.client.zcard(RedisKeys.activeCalls)).resolves.toBe(1);
      await expect(
        redis.client.get(RedisKeys.metrics.callsTotal),
      ).resolves.toBe('1');

      await callState.transition(
        call.id,
        CallStatus.QUEUED,
        CallStatus.RINGING,
      );
      await callState.transition(
        call.id,
        CallStatus.RINGING,
        CallStatus.UNANSWERED,
      );
      await callState.transition(
        call.id,
        CallStatus.UNANSWERED,
        CallStatus.COMPLETED,
      );

      await expect(redis.client.zcard(RedisKeys.activeCalls)).resolves.toBe(0);
      await expect(
        redis.client.ttl(RedisKeys.call(call.id)),
      ).resolves.toBeGreaterThan(0);
      await expect(redis.client.xlen(RedisKeys.eventStream)).resolves.toBe(4);
    });

    it('refuses to create a call twice or mutate an unknown call', async () => {
      await callState.create(call);
      await expect(callState.create(call)).resolves.toMatchObject({
        applied: false,
        reason: 'EXISTS',
      });
      await expect(
        callState.append('missing', CallEventType.RECORDING_UPLOAD_FAILED),
      ).resolves.toMatchObject({ applied: false, reason: 'NOT_FOUND' });
    });
  });
});
