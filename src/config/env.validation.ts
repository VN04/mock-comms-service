import * as Joi from 'joi';

/**
 * Validates environment variables at boot. The app refuses to start with a
 * missing/invalid value instead of failing later at runtime.
 */
/** `<PREFIX>_MIN_MS` / `<PREFIX>_MAX_MS` pair, where MAX must be >= MIN. */
function delayRange(prefix: string, min: number, max: number) {
  return {
    [`${prefix}_MIN_MS`]: Joi.number().integer().min(0).default(min),
    [`${prefix}_MAX_MS`]: Joi.number()
      .integer()
      .min(Joi.ref(`${prefix}_MIN_MS`))
      .default(max),
  };
}

// `.empty('')` treats blank values as unset, so e.g. `S3_ENDPOINT=` switches
// storage from MinIO to real AWS S3.
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  PUBLIC_BASE_URL: Joi.string().uri().empty('').optional(),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(3306),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  DB_POOL_SIZE: Joi.number().integer().min(1).default(10),

  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  STORAGE_DRIVER: Joi.string().valid('s3').default('s3'),
  S3_BUCKET: Joi.string().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ENDPOINT: Joi.string().uri().empty('').optional(),
  S3_PUBLIC_ENDPOINT: Joi.string().uri().empty('').optional(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(false),
  S3_ACCESS_KEY_ID: Joi.string().empty('').optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().empty('').optional(),
  RECORDING_URL_TTL_SECONDS: Joi.number().integer().min(60).default(3600),
  RECORDING_UPLOAD_ATTEMPTS: Joi.number().integer().min(1).default(5),

  CALL_PROVIDER: Joi.string().valid('mock').default('mock'),
  // Per-state delay ranges of the mock provider. Defaults keep every call
  // alive for at least 30s (answered: 33-49s, unanswered: 30-41s).
  ...delayRange('MOCK_QUEUED_DELAY', 5000, 7000),
  ...delayRange('MOCK_RINGING_DELAY', 8000, 12000),
  ...delayRange('MOCK_TALK_DURATION', 20000, 30000),
  ...delayRange('MOCK_UNANSWERED_DELAY', 17000, 22000),
  MOCK_ANSWER_PROBABILITY: Joi.number().min(0).max(1).default(0.5),

  RATE_LIMIT_DEFAULT_MAX_CONCURRENT: Joi.number().integer().min(1).default(3),
  RATE_LIMIT_DEFAULT_MAX_CPS: Joi.number().integer().min(1).default(2),
  RATE_LIMIT_STALE_SLOT_MS: Joi.number().integer().min(1000).default(600000),

  API_KEY_CACHE_TTL_SECONDS: Joi.number().integer().min(1).default(60),
  IDEMPOTENCY_TTL_SECONDS: Joi.number().integer().min(60).default(86400),
  CALL_STATE_TTL_SECONDS: Joi.number().integer().min(60).default(3600),
  WS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(3600),
  WS_TOKEN_GRACE_SECONDS: Joi.number().integer().min(10).default(300),

  PERSISTENCE_FLUSH_INTERVAL_MS: Joi.number().integer().min(500).default(5000),
  PERSISTENCE_BATCH_SIZE: Joi.number().integer().min(1).default(500),
  EVENT_STREAM_MAX_LENGTH: Joi.number().integer().min(1000).default(1000000),

  SEED_ADMIN_API_KEY: Joi.string().min(16).empty('').optional(),
  SEED_CLIENT_API_KEY: Joi.string().min(16).empty('').optional(),
});

/** Env after Joi validation: defaults applied, numbers/booleans coerced. */
export type ValidatedEnv = Record<string, any>;

/** Validates `process.env`-like input, throwing a readable error listing every problem. */
export function validateEnv(env: NodeJS.ProcessEnv): ValidatedEnv {
  const result = envValidationSchema.validate(env, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });
  if (result.error) {
    throw new Error(
      `Invalid environment configuration: ${result.error.message}`,
    );
  }
  return result.value as ValidatedEnv;
}
