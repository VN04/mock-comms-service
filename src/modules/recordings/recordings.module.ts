import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Queues } from '../../common/constants/queues';
import { CallUpdatesModule } from '../call-updates/call-updates.module';
import { MetricsModule } from '../metrics/metrics.module';
import { RecordingsService } from './recordings.service';

/** RecordingsProcessor is registered by the WorkerModule only. */
@Module({
  imports: [
    BullModule.registerQueue({ name: Queues.RECORDINGS }),
    CallUpdatesModule,
    MetricsModule,
  ],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
