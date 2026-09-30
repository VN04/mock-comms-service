import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { CallHistoryModule } from './modules/call-history/call-history.module';
import { CallUpdatesGatewayModule } from './modules/call-updates/call-updates-gateway.module';
import { CallsModule } from './modules/calls/calls.module';
import { HealthModule } from './modules/health/health.module';
import { HttpMetricsInterceptor } from './modules/metrics/http-metrics.interceptor';
import { MetricsModule } from './modules/metrics/metrics.module';

/** API process: REST + WebSocket. Never runs background jobs. */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    AuthModule,
    CallsModule,
    CallHistoryModule,
    CallUpdatesGatewayModule,
    MetricsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: HttpMetricsInterceptor },
  ],
})
export class AppModule {}
