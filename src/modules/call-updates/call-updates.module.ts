import { Module } from '@nestjs/common';
import { CallUpdatesService } from './call-updates.service';

/** Pub/sub publishing + WebSocket tokens (used by both API and worker). */
@Module({
  providers: [CallUpdatesService],
  exports: [CallUpdatesService],
})
export class CallUpdatesModule {}
