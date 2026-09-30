import { buildConfig } from './configuration';
import { validateEnv } from './env.validation';

const REQUIRED_ENV = {
  DB_HOST: 'localhost',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'db',
  REDIS_URL: 'redis://localhost:6379',
  S3_BUCKET: 'recordings',
};

describe('configuration', () => {
  it('default mock timings keep every call alive for at least 30 seconds', () => {
    const { mock } = buildConfig(validateEnv(REQUIRED_ENV)).callProvider;
    const base = mock.queuedDelayMs.min + mock.ringingDelayMs.min;

    expect(base + mock.talkDurationMs.min).toBeGreaterThanOrEqual(30_000);
    expect(base + mock.unansweredDelayMs.min).toBeGreaterThanOrEqual(30_000);
  });

  it('rejects a delay range whose max is below its min', () => {
    expect(() =>
      validateEnv({
        ...REQUIRED_ENV,
        MOCK_QUEUED_DELAY_MIN_MS: '5000',
        MOCK_QUEUED_DELAY_MAX_MS: '1000',
      }),
    ).toThrow(/MOCK_QUEUED_DELAY_MAX_MS/);
  });

  it('treats blank optional values as unset (e.g. S3_ENDPOINT= → AWS)', () => {
    const cfg = buildConfig(validateEnv({ ...REQUIRED_ENV, S3_ENDPOINT: '' }));
    expect(cfg.storage.endpoint).toBeUndefined();
  });
});
