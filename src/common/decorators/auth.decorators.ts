import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiKeyContext, ApiKeyRole } from '../auth/api-key-context';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Opts a route out of API-key auth (health checks, Prometheus scrape). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given roles. */
export const Roles = (...roles: ApiKeyRole[]) => SetMetadata(ROLES_KEY, roles);

/** Request property holding the authenticated key. */
export const API_KEY_REQUEST_PROPERTY = 'apiKey';

/** Injects the authenticated caller: `@CurrentApiKey() apiKey: ApiKeyContext`. */
export const CurrentApiKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiKeyContext =>
    ctx.switchToHttp().getRequest<Record<string, ApiKeyContext>>()[
      API_KEY_REQUEST_PROPERTY
    ],
);
