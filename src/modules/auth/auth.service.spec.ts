import { NotFoundException } from '@nestjs/common';
import { ApiKeyRole } from '../../common/auth/api-key-context';
import { hashApiKey } from '../../common/auth/api-key-crypto';
import { mockConfig } from '../../common/testing/fixtures';
import { ApiKeyEntity } from '../../infrastructure/database/entities/api-key.entity';
import { ApiKeyRepository } from '../../infrastructure/database/repositories/api-key.repository';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuthService } from './auth.service';

const entity = (overrides: Partial<ApiKeyEntity> = {}): ApiKeyEntity => ({
  id: 'key-1',
  name: 'acme',
  keyPrefix: 'mcs_abc',
  keyHash: hashApiKey('raw-key'),
  role: ApiKeyRole.CLIENT,
  maxConcurrentCalls: null,
  maxCps: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  revokedAt: null,
  ...overrides,
});

describe('AuthService', () => {
  let repo: jest.Mocked<ApiKeyRepository>;
  let redisClient: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    repo = {
      findActiveByHash: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      revoke: jest.fn(),
    } as unknown as jest.Mocked<ApiKeyRepository>;
    redisClient = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    service = new AuthService(
      repo,
      { client: redisClient } as unknown as RedisService,
      mockConfig({
        auth: { apiKeyCacheTtlSeconds: 60 },
        rateLimit: { defaultMaxConcurrent: 3, defaultMaxCps: 2 },
      }),
    );
  });

  describe('authenticate', () => {
    it('returns the cached context without touching MySQL', async () => {
      const cached = { id: 'key-1', role: ApiKeyRole.CLIENT };
      redisClient.get.mockResolvedValue(JSON.stringify(cached));

      await expect(service.authenticate('raw-key')).resolves.toEqual(cached);
      expect(redisClient.get).toHaveBeenCalledWith(
        `apikey:${hashApiKey('raw-key')}`,
      );
      expect(repo.findActiveByHash).not.toHaveBeenCalled();
    });

    it('loads from MySQL on a miss, applying default limits, and caches it', async () => {
      redisClient.get.mockResolvedValue(null);
      repo.findActiveByHash.mockResolvedValue(entity());

      const ctx = await service.authenticate('raw-key');

      expect(ctx).toEqual({
        id: 'key-1',
        name: 'acme',
        role: ApiKeyRole.CLIENT,
        maxConcurrentCalls: 3, // NULL override → default
        maxCps: 5, // per-key override wins
      });
      expect(redisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(ctx),
        'EX',
        60,
      );
    });

    it('negatively caches unknown keys briefly', async () => {
      redisClient.get.mockResolvedValue(null);
      repo.findActiveByHash.mockResolvedValue(null);

      await expect(service.authenticate('nope')).resolves.toBeNull();
      expect(redisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        'null',
        'EX',
        10,
      );
    });

    it('treats a negatively cached key as invalid', async () => {
      redisClient.get.mockResolvedValue('null');
      await expect(service.authenticate('nope')).resolves.toBeNull();
      expect(repo.findActiveByHash).not.toHaveBeenCalled();
    });
  });

  describe('key management', () => {
    it('creates a key storing only its hash, returning the raw key once', async () => {
      repo.create.mockImplementation((data) =>
        Promise.resolve(entity(data as Partial<ApiKeyEntity>)),
      );

      const { entity: created, rawKey } = await service.createKey({
        name: 'acme',
        max_cps: 10,
      });

      expect(rawKey).toMatch(/^mcs_/);
      expect(created.keyHash).toBe(hashApiKey(rawKey));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: ApiKeyRole.CLIENT,
          maxCps: 10,
          maxConcurrentCalls: null,
        }),
      );
    });

    it('updates only provided fields and invalidates the cache', async () => {
      const updated = entity({ maxCps: 7 });
      repo.findById.mockResolvedValue(entity());
      repo.update.mockResolvedValue(updated);

      await service.updateKey('key-1', { max_cps: 7 });

      expect(repo.update).toHaveBeenCalledWith('key-1', { maxCps: 7 });
      expect(redisClient.del).toHaveBeenCalledWith(`apikey:${updated.keyHash}`);
    });

    it('revokes a key and invalidates the cache', async () => {
      repo.findById.mockResolvedValue(entity());
      repo.revoke.mockResolvedValue(entity({ isActive: false }));

      await service.revokeKey('key-1');
      expect(redisClient.del).toHaveBeenCalled();
    });

    it('404s for an unknown key', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.revokeKey('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
