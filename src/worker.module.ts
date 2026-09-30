import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { CallLifecycleModule } from './modules/call-lifecycle/call-lifecycle.module';
import { CallProviderModule } from './modules/call-provider/call-provider.module';
import { MockCallProcessor } from './modules/call-provider/mock/mock-call.processor';
import { PersistenceModule } from './modules/persistence/persistence.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { RecordingsProcessor } from './modules/recordings/recordings.processor';

/**
 * Worker process: consumes every BullMQ queue. The processors are listed
 * here explicitly so it's obvious which background jobs run where (the API
 * process only enqueues).
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    CallLifecycleModule,
    CallProviderModule,
    RecordingsModule,
    PersistenceModule,
  ],
  providers: [MockCallProcessor, RecordingsProcessor],
})
export class WorkerModule {}
