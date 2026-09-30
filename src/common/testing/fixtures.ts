/* Shared test fixtures for unit specs (not part of the runtime build). */
import { ConfigService } from '@nestjs/config';
import { ApiKeyContext, ApiKeyRole } from '../auth/api-key-context';
import { CallEvent, CallEventType } from '../call/call-event';
import { CallRecord } from '../call/call-record';
import { CallStatus } from '../call/call-status';
import { AppConfig } from '../../config/configuration';

type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> };

/** ConfigService stand-in resolving dotted paths against a partial config. */
export function mockConfig(
  values: DeepPartial<AppConfig>,
): ConfigService<AppConfig, true> {
  return {
    get: (path: string) =>
      path
        .split('.')
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown> | undefined)?.[key],
          values,
        ),
  } as unknown as ConfigService<AppConfig, true>;
}

export const makeApiKey = (
  overrides: Partial<ApiKeyContext> = {},
): ApiKeyContext => ({
  id: 'key-1',
  name: 'test',
  role: ApiKeyRole.CLIENT,
  maxConcurrentCalls: 3,
  maxCps: 2,
  ...overrides,
});

export const makeCall = (overrides: Partial<CallRecord> = {}): CallRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  apiKeyId: 'key-1',
  from: '+14155550100',
  to: '+14155550101',
  metadata: null,
  status: CallStatus.QUEUED,
  outcome: null,
  provider: 'mock',
  queuedAt: 1_700_000_000_000,
  ringingAt: null,
  answeredAt: null,
  unansweredAt: null,
  completedAt: null,
  recordingStatus: null,
  recordingKey: null,
  recordingUrl: null,
  recordingUploadedAt: null,
  updatedAt: 1_700_000_000_000,
  lastSequence: 1,
  ...overrides,
});

export const makeEvent = (overrides: Partial<CallEvent> = {}): CallEvent => ({
  callId: '11111111-1111-4111-8111-111111111111',
  sequence: 1,
  type: CallEventType.CALL_CREATED,
  fromStatus: null,
  toStatus: CallStatus.QUEUED,
  payload: null,
  occurredAt: 1_700_000_000_000,
  ...overrides,
});
