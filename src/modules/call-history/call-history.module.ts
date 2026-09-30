import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module';
import { CallHistoryController } from './call-history.controller';
import { CallHistoryService } from './call-history.service';

@Module({
  imports: [CallsModule],
  controllers: [CallHistoryController],
  providers: [CallHistoryService],
})
export class CallHistoryModule {}
