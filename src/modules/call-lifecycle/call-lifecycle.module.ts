import { Module } from '@nestjs/common';
import { CallUpdatesModule } from '../call-updates/call-updates.module';
import { MetricsModule } from '../metrics/metrics.module';
import { RateLimiterModule } from '../rate-limiter/rate-limiter.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { CallLifecycleService } from './call-lifecycle.service';

@Module({
  imports: [
    CallUpdatesModule,
    MetricsModule,
    RateLimiterModule,
    RecordingsModule,
  ],
  providers: [CallLifecycleService],
  exports: [CallLifecycleService],
})
export class CallLifecycleModule {}
