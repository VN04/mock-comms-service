import { createHash, randomBytes } from 'node:crypto';

const KEY_PREFIX = 'mcs_';
const DISPLAY_PREFIX_LENGTH = 12;

/** New random API key, e.g. `mcs_3q2x...` (32 bytes of entropy). */
export const generateApiKey = (): string =>
  KEY_PREFIX + randomBytes(32).toString('base64url');

/** Keys are stored and looked up by SHA-256 hash only — never in plaintext. */
export const hashApiKey = (rawKey: string): string =>
  createHash('sha256').update(rawKey).digest('hex');

/** Short, non-secret prefix shown in listings to identify a key. */
export const apiKeyDisplayPrefix = (rawKey: string): string =>
  rawKey.slice(0, DISPLAY_PREFIX_LENGTH);
