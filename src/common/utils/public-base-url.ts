import { Request } from 'express';

/**
 * Public base URL of the API as seen by the client: PUBLIC_BASE_URL when
 * configured, otherwise derived from the request (honours X-Forwarded-*,
 * since `trust proxy` is enabled for deployments behind a load balancer).
 */
export const resolvePublicBaseUrl = (
  req: Request,
  configured?: string,
): string => configured ?? `${req.protocol}://${req.get('host')}`;
