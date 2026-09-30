import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ApiKeyContext, ApiKeyRole } from '../../common/auth/api-key-context';
import {
  apiKeyDisplayPrefix,
  generateApiKey,
  hashApiKey,
} from '../../common/auth/api-key-crypto';
import { RedisKeys } from '../../common/constants/redis-keys';
import { AppConfig } from '../../config/configuration';
import { ApiKeyEntity } from '../../infrastructure/database/entities/api-key.entity';
import {
  ApiKeyPatch,
  ApiKeyRepository,
} from '../../infrastructure/database/repositories/api-key.repository';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

/** Unknown keys are cached briefly so invalid-key floods don't hit MySQL. */
const NEGATIVE_CACHE_TTL_SECONDS = 10;
const NEGATIVE_CACHE_VALUE = 'null';

/**
 * API key authentication (hot path, Redis-cached) and admin key management.
 */
@Injectable()
export class AuthService {
  private readonly cacheTtl: number;
  private readonly defaults: { maxConcurrentCalls: number; maxCps: number };

  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly redis: RedisService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cacheTtl = config.get('auth.apiKeyCacheTtlSeconds', { infer: true });
    const rl = config.get('rateLimit', { infer: true });
    this.defaults = {
      maxConcurrentCalls: rl.defaultMaxConcurrent,
      maxCps: rl.defaultMaxCps,
    };
  }

  /** Resolves a raw bearer token to its key context, or null if invalid/revoked. */
  async authenticate(rawKey: string): Promise<ApiKeyContext | null> {
    const keyHash = hashApiKey(rawKey);
    const cacheKey = RedisKeys.apiKeyCache(keyHash);

    const cached = await this.redis.client.get(cacheKey);
    if (cached !== null) {
      return cached === NEGATIVE_CACHE_VALUE
        ? null
        : (JSON.parse(cached) as ApiKeyContext);
    }

    const entity = await this.apiKeys.findActiveByHash(keyHash);
    const context = entity ? this.toContext(entity) : null;
    await this.redis.client.set(
      cacheKey,
      context ? JSON.stringify(context) : NEGATIVE_CACHE_VALUE,
      'EX',
      context ? this.cacheTtl : NEGATIVE_CACHE_TTL_SECONDS,
    );
    return context;
  }

  /** Creates a key. The raw secret is returned exactly once. */
  async createKey(
    dto: CreateApiKeyDto,
  ): Promise<{ entity: ApiKeyEntity; rawKey: string }> {
    const rawKey = generateApiKey();
    const entity = await this.apiKeys.create({
      id: randomUUID(),
      name: dto.name,
      role: dto.role ?? ApiKeyRole.CLIENT,
      keyHash: hashApiKey(rawKey),
      keyPrefix: apiKeyDisplayPrefix(rawKey),
      maxConcurrentCalls: dto.max_concurrent_calls ?? null,
      maxCps: dto.max_cps ?? null,
    });
    return { entity, rawKey };
  }

  listKeys(): Promise<ApiKeyEntity[]> {
    return this.apiKeys.findAll();
  }

  async updateKey(id: string, dto: UpdateApiKeyDto): Promise<ApiKeyEntity> {
    const patch: ApiKeyPatch = {
      name: dto.name,
      maxConcurrentCalls: dto.max_concurrent_calls,
      maxCps: dto.max_cps,
      isActive: dto.is_active,
    };
    // Drop fields the caller didn't send (null is a meaningful "reset to default").
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as ApiKeyPatch;
    await this.getKeyOrThrow(id);
    const updated = await this.apiKeys.update(id, cleaned);
    await this.invalidateCache(updated!);
    return updated!;
  }

  async revokeKey(id: string): Promise<ApiKeyEntity> {
    await this.getKeyOrThrow(id);
    const revoked = await this.apiKeys.revoke(id);
    await this.invalidateCache(revoked!);
    return revoked!;
  }

  private async getKeyOrThrow(id: string): Promise<ApiKeyEntity> {
    const entity = await this.apiKeys.findById(id);
    if (!entity) throw new NotFoundException('API key not found');
    return entity;
  }

  /** Limit/status changes apply on the next request, not after the cache TTL. */
  private async invalidateCache(entity: ApiKeyEntity): Promise<void> {
    await this.redis.client.del(RedisKeys.apiKeyCache(entity.keyHash));
  }

  private toContext(entity: ApiKeyEntity): ApiKeyContext {
    return {
      id: entity.id,
      name: entity.name,
      role: entity.role,
      maxConcurrentCalls:
        entity.maxConcurrentCalls ?? this.defaults.maxConcurrentCalls,
      maxCps: entity.maxCps ?? this.defaults.maxCps,
    };
  }
}
