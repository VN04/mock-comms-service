import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { RateLimiterService } from './rate-limiter.service';

@Module({
  imports: [MetricsModule],
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimiterModule {}
