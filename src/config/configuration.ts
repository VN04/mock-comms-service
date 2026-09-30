import { ValidatedEnv, validateEnv } from './env.validation';

/**
 * Typed configuration tree built from (already validated) env vars.
 * Consumers inject `ConfigService<AppConfig, true>` and read e.g.
 * `config.get('rateLimit.defaultMaxCps', { infer: true })`.
 */
export interface AppConfig {
  app: { env: string; port: number; publicBaseUrl?: string };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    poolSize: number;
  };
  redis: { url: string };
  storage: {
    driver: 's3';
    bucket: string;
    region: string;
    endpoint?: string;
    publicEndpoint?: string;
    forcePathStyle: boolean;
    accessKeyId?: string;
    secretAccessKey?: string;
    signedUrlTtlSeconds: number;
  };
  recordings: { uploadAttempts: number };
  callProvider: {
    driver: 'mock';
    mock: {
      stepDelayMinMs: number;
      stepDelayMaxMs: number;
      talkDurationMinMs: number;
      talkDurationMaxMs: number;
      answerProbability: number;
    };
  };
  rateLimit: {
    defaultMaxConcurrent: number;
    defaultMaxCps: number;
    staleSlotMs: number;
  };
  auth: { apiKeyCacheTtlSeconds: number };
  idempotency: { ttlSeconds: number };
  callState: { ttlSeconds: number; eventStreamMaxLength: number };
  wsToken: { ttlSeconds: number; graceSeconds: number };
  persistence: { flushIntervalMs: number; batchSize: number };
}

/**
 * Maps validated env vars into the typed config tree (defaults live in the Joi
 * schema). Joi has already coerced every value to the right type, so the
 * untyped reads below are safe.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
export function buildConfig(env: ValidatedEnv): AppConfig {
  return {
    app: {
      env: env.NODE_ENV,
      port: env.PORT,
      publicBaseUrl: env.PUBLIC_BASE_URL,
    },
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      name: env.DB_NAME,
      poolSize: env.DB_POOL_SIZE,
    },
    redis: { url: env.REDIS_URL },
    storage: {
      driver: env.STORAGE_DRIVER,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      signedUrlTtlSeconds: env.RECORDING_URL_TTL_SECONDS,
    },
    recordings: { uploadAttempts: env.RECORDING_UPLOAD_ATTEMPTS },
    callProvider: {
      driver: env.CALL_PROVIDER,
      mock: {
        stepDelayMinMs: env.MOCK_STEP_DELAY_MIN_MS,
        stepDelayMaxMs: env.MOCK_STEP_DELAY_MAX_MS,
        talkDurationMinMs: env.MOCK_TALK_DURATION_MIN_MS,
        talkDurationMaxMs: env.MOCK_TALK_DURATION_MAX_MS,
        answerProbability: env.MOCK_ANSWER_PROBABILITY,
      },
    },
    rateLimit: {
      defaultMaxConcurrent: env.RATE_LIMIT_DEFAULT_MAX_CONCURRENT,
      defaultMaxCps: env.RATE_LIMIT_DEFAULT_MAX_CPS,
      staleSlotMs: env.RATE_LIMIT_STALE_SLOT_MS,
    },
    auth: { apiKeyCacheTtlSeconds: env.API_KEY_CACHE_TTL_SECONDS },
    idempotency: { ttlSeconds: env.IDEMPOTENCY_TTL_SECONDS },
    callState: {
      ttlSeconds: env.CALL_STATE_TTL_SECONDS,
      eventStreamMaxLength: env.EVENT_STREAM_MAX_LENGTH,
    },
    wsToken: {
      ttlSeconds: env.WS_TOKEN_TTL_SECONDS,
      graceSeconds: env.WS_TOKEN_GRACE_SECONDS,
    },
    persistence: {
      flushIntervalMs: env.PERSISTENCE_FLUSH_INTERVAL_MS,
      batchSize: env.PERSISTENCE_BATCH_SIZE,
    },
  };
}

/* eslint-enable @typescript-eslint/no-unsafe-assignment */

/** Nest `ConfigModule` loader: validate once, then build the typed tree. */
export const configuration = (): AppConfig =>
  buildConfig(validateEnv(process.env));
