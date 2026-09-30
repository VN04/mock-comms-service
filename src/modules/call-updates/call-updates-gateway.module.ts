import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { CallUpdatesGateway } from './call-updates.gateway';
import { CallUpdatesModule } from './call-updates.module';

/** The WebSocket server — imported by the API app only (never the worker). */
@Module({
  imports: [AuthModule, CallsModule, CallUpdatesModule],
  providers: [CallUpdatesGateway],
})
export class CallUpdatesGatewayModule {}
