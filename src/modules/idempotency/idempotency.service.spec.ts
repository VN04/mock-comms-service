import { ConflictException } from '@nestjs/common';
import { mockConfig } from '../../common/testing/fixtures';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let client: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let service: IdempotencyService;

  beforeEach(() => {
    client = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    service = new IdempotencyService(
      { client } as unknown as RedisService,
      mockConfig({ idempotency: { ttlSeconds: 86400 } }),
    );
  });

  it('claims a fresh key atomically (SET NX)', async () => {
    client.set.mockResolvedValue('OK');
    await expect(service.claim('key-1', 'abc')).resolves.toEqual({
      status: 'claimed',
    });
    expect(client.set).toHaveBeenCalledWith(
      'idempotency:key-1:abc',
      expect.any(String),
      'EX',
      30,
      'NX',
    );
  });

  it('returns the stored resource for a completed key', async () => {
    client.set.mockResolvedValue(null);
    client.get.mockResolvedValue('call-123');
    await expect(service.claim('key-1', 'abc')).resolves.toEqual({
      status: 'completed',
      resourceId: 'call-123',
    });
  });

  it('409s while the original request is still in progress', async () => {
    client.set.mockResolvedValue(null);
    client.get.mockResolvedValue('__in_progress__');
    await expect(service.claim('key-1', 'abc')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('stores the result for the full TTL on completion', async () => {
    await service.complete('key-1', 'abc', 'call-123');
    expect(client.set).toHaveBeenCalledWith(
      'idempotency:key-1:abc',
      'call-123',
      'EX',
      86400,
    );
  });

  it('releases the claim so a failed request can be retried', async () => {
    await service.release('key-1', 'abc');
    expect(client.del).toHaveBeenCalledWith('idempotency:key-1:abc');
  });
});
