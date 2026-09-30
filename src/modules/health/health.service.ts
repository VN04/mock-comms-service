import { Injectable } from '@nestjs/common';
import { TransactionRunner } from '../../infrastructure/database/transaction.runner';
import { RedisService } from '../../infrastructure/redis/redis.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { redis: boolean; database: boolean };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly redis: RedisService,
    private readonly db: TransactionRunner,
  ) {}

  async check(): Promise<HealthReport> {
    const [redis, database] = await Promise.all([
      this.redis.ping().catch(() => false),
      this.db.ping().catch(() => false),
    ]);
    return {
      status: redis && database ? 'ok' : 'degraded',
      checks: { redis, database },
    };
  }
}
