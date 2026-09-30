import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyContext } from '../../common/auth/api-key-context';
import { RedisKeys } from '../../common/constants/redis-keys';
import { AppConfig } from '../../config/configuration';
import { RESERVE_CALL_SLOT_LUA } from '../../infrastructure/redis/lua/reserve-call-slot.lua';
import {
  LuaScript,
  RedisService,
} from '../../infrastructure/redis/redis.service';
import { MetricsService, RateLimitReason } from '../metrics/metrics.service';

const RESERVE_CALL_SLOT: LuaScript = {
  name: 'reserveCallSlot',
  lua: RESERVE_CALL_SLOT_LUA,
  numberOfKeys: 2,
};

export class RateLimitExceededException extends HttpException {
  constructor(readonly reason: RateLimitReason) {
    super('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Per-API-key concurrent-call and calls-per-second limits.
 * Both are checked and reserved in ONE atomic Lua script (see
 * reserve-call-slot.lua), so concurrent requests can't race past a limit.
 */
@Injectable()
export class RateLimiterService {
  private readonly staleSlotMs: number;

  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.staleSlotMs = config.get('rateLimit.staleSlotMs', { infer: true });
  }

  /** Reserves a concurrency + CPS slot for `callId`, or throws 429. */
  async reserve(apiKey: ApiKeyContext, callId: string): Promise<void> {
    const [allowed, reason] = await this.redis.runScript<
      [number, 'OK' | RateLimitReason]
    >(
      RESERVE_CALL_SLOT,
      [RedisKeys.rateLimitActive(apiKey.id), RedisKeys.rateLimitCps(apiKey.id)],
      [callId, apiKey.maxConcurrentCalls, apiKey.maxCps, this.staleSlotMs],
    );
    if (allowed !== 1) {
      await this.metrics.recordRateLimitRejection(reason as RateLimitReason);
      throw new RateLimitExceededException(reason as RateLimitReason);
    }
  }

  /** Frees the concurrency slot (idempotent). CPS entries simply age out. */
  async release(apiKeyId: string, callId: string): Promise<void> {
    await this.redis.client.zrem(RedisKeys.rateLimitActive(apiKeyId), callId);
  }
}
