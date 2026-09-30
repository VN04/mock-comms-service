import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisKeys } from '../../common/constants/redis-keys';
import { AppConfig } from '../../config/configuration';
import { RedisService } from '../../infrastructure/redis/redis.service';

const IN_PROGRESS = '__in_progress__';
/** An in-progress claim expires quickly so a crashed request can't block the key. */
const IN_PROGRESS_TTL_SECONDS = 30;

export type IdempotencyClaim =
  { status: 'claimed' } | { status: 'completed'; resourceId: string };

/**
 * `Idempotency-Key` support: a retried request with the same key returns the
 * original result instead of creating a duplicate (e.g. a second call).
 * Keys are scoped per API key.
 */
@Injectable()
export class IdempotencyService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.ttlSeconds = config.get('idempotency.ttlSeconds', { infer: true });
  }

  /**
   * Atomically claims the key (SET NX). Returns the stored resource ID if the
   * original request already completed; throws 409 if it is still running.
   */
  async claim(apiKeyId: string, key: string): Promise<IdempotencyClaim> {
    const redisKey = RedisKeys.idempotency(apiKeyId, key);
    const claimed = await this.redis.client.set(
      redisKey,
      IN_PROGRESS,
      'EX',
      IN_PROGRESS_TTL_SECONDS,
      'NX',
    );
    if (claimed) return { status: 'claimed' };

    const existing = await this.redis.client.get(redisKey);
    if (existing === null) return this.claim(apiKeyId, key); // expired in between
    if (existing === IN_PROGRESS) {
      throw new ConflictException(
        'A request with this Idempotency-Key is already in progress',
      );
    }
    return { status: 'completed', resourceId: existing };
  }

  /** Stores the created resource ID for the full idempotency window. */
  async complete(
    apiKeyId: string,
    key: string,
    resourceId: string,
  ): Promise<void> {
    await this.redis.client.set(
      RedisKeys.idempotency(apiKeyId, key),
      resourceId,
      'EX',
      this.ttlSeconds,
    );
  }

  /** Releases the claim when the request failed, so the client may retry. */
  async release(apiKeyId: string, key: string): Promise<void> {
    await this.redis.client.del(RedisKeys.idempotency(apiKeyId, key));
  }
}
