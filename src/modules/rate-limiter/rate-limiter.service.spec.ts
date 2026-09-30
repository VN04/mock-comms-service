import { HttpStatus } from '@nestjs/common';
import { makeApiKey, mockConfig } from '../../common/testing/fixtures';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  RateLimiterService,
  RateLimitExceededException,
} from './rate-limiter.service';

describe('RateLimiterService', () => {
  let redis: { runScript: jest.Mock; client: { zrem: jest.Mock } };
  let metrics: { recordRateLimitRejection: jest.Mock };
  let service: RateLimiterService;

  beforeEach(() => {
    redis = { runScript: jest.fn(), client: { zrem: jest.fn() } };
    metrics = { recordRateLimitRejection: jest.fn() };
    service = new RateLimiterService(
      redis as unknown as RedisService,
      metrics as unknown as MetricsService,
      mockConfig({ rateLimit: { staleSlotMs: 600000 } }),
    );
  });

  it('passes the key-specific limits to the atomic script', async () => {
    redis.runScript.mockResolvedValue([1, 'OK']);

    await service.reserve(
      makeApiKey({ maxConcurrentCalls: 3, maxCps: 2 }),
      'call-1',
    );

    expect(redis.runScript).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'reserveCallSlot', numberOfKeys: 2 }),
      ['ratelimit:{key-1}:active', 'ratelimit:{key-1}:cps'],
      ['call-1', 3, 2, 600000],
    );
    expect(metrics.recordRateLimitRejection).not.toHaveBeenCalled();
  });

  it.each(['CPS', 'CONCURRENCY'] as const)(
    'throws 429 "Rate limit exceeded" and records a %s rejection',
    async (reason) => {
      redis.runScript.mockResolvedValue([0, reason]);

      const attempt = service.reserve(makeApiKey(), 'call-1');

      await expect(attempt).rejects.toBeInstanceOf(RateLimitExceededException);
      await attempt.catch((err: RateLimitExceededException) => {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(err.message).toBe('Rate limit exceeded');
      });
      expect(metrics.recordRateLimitRejection).toHaveBeenCalledWith(reason);
    },
  );

  it('releases a concurrency slot', async () => {
    await service.release('key-1', 'call-1');
    expect(redis.client.zrem).toHaveBeenCalledWith(
      'ratelimit:{key-1}:active',
      'call-1',
    );
  });
});
