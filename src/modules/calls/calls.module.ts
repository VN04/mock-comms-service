import { Module } from '@nestjs/common';
import { CallProviderModule } from '../call-provider/call-provider.module';
import { CallUpdatesModule } from '../call-updates/call-updates.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { MetricsModule } from '../metrics/metrics.module';
import { RateLimiterModule } from '../rate-limiter/rate-limiter.module';
import { CallPresenter } from './call.presenter';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [
    CallProviderModule,
    CallUpdatesModule,
    IdempotencyModule,
    MetricsModule,
    RateLimiterModule,
  ],
  controllers: [CallsController],
  providers: [CallsService, CallPresenter],
  exports: [CallsService, CallPresenter],
})
export class CallsModule {}
