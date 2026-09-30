import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Queues } from '../../common/constants/queues';
import { PersistenceProcessor } from './persistence.processor';
import { PersistenceService } from './persistence.service';

/** Worker-only: Redis → MySQL batch persistence. */
@Module({
  imports: [BullModule.registerQueue({ name: Queues.PERSISTENCE })],
  providers: [PersistenceService, PersistenceProcessor],
})
export class PersistenceModule {}
