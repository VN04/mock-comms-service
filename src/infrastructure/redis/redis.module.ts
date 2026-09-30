import { Global, Module } from '@nestjs/common';
import { CallEventStreamRepository } from './repositories/call-event-stream.repository';
import { CallStateRepository } from './repositories/call-state.repository';
import { RedisService } from './redis.service';

/** Redis connection plus the Redis-backed repositories (live call state). */
@Global()
@Module({
  providers: [RedisService, CallStateRepository, CallEventStreamRepository],
  exports: [RedisService, CallStateRepository, CallEventStreamRepository],
})
export class RedisModule {}
