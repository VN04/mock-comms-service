import { ServiceUnavailableException } from '@nestjs/common';
import { TransactionRunner } from '../../infrastructure/database/transaction.runner';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  const redis = { ping: jest.fn() };
  const db = { ping: jest.fn() };
  const controller = new HealthController(
    new HealthService(
      redis as unknown as RedisService,
      db as unknown as TransactionRunner,
    ),
  );

  it('reports ok when Redis and MySQL respond', async () => {
    redis.ping.mockResolvedValue(true);
    db.ping.mockResolvedValue(true);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      checks: { redis: true, database: true },
    });
  });

  it('returns 503 when a dependency is down', async () => {
    redis.ping.mockResolvedValue(true);
    db.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
