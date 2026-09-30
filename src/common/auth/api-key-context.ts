export enum ApiKeyRole {
  ADMIN = 'admin',
  CLIENT = 'client',
}

/** The authenticated caller, attached to every request by the ApiKeyGuard. */
export interface ApiKeyContext {
  id: string;
  name: string;
  role: ApiKeyRole;
  /** Effective limits (per-key override or global default). */
  maxConcurrentCalls: number;
  maxCps: number;
}
