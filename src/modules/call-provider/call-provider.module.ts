import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queues } from '../../common/constants/queues';
import { AppConfig } from '../../config/configuration';
import { CALL_PROVIDER, CallProvider } from './call-provider.interface';
import { MockCallProvider } from './mock/mock-call.provider';

/**
 * Selects the telephony provider from config (CALL_PROVIDER env).
 * To add e.g. Twilio: add `TwilioCallProvider`, list it in `providers`, and
 * return it from the factory below. Nothing else in the app changes.
 * (MockCallProcessor is registered by the WorkerModule only.)
 */
@Module({
  imports: [BullModule.registerQueue({ name: Queues.MOCK_PROVIDER })],
  providers: [
    MockCallProvider,
    {
      provide: CALL_PROVIDER,
      inject: [ConfigService, MockCallProvider],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        mock: MockCallProvider,
      ): CallProvider => {
        const driver = config.get('callProvider.driver', { infer: true });
        switch (driver) {
          case 'mock':
            return mock;
          default:
            throw new Error(`Unsupported CALL_PROVIDER "${String(driver)}"`);
        }
      },
    },
  ],
  exports: [CALL_PROVIDER, MockCallProvider],
})
export class CallProviderModule {}
