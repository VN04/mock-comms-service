import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiKeyRole } from '../../../common/auth/api-key-context';
import {
  API_KEY_REQUEST_PROPERTY,
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../../../common/decorators/auth.decorators';
import { AuthService } from '../auth.service';

/** Extracts the key from `Authorization: Bearer <key>`. */
export const extractBearerToken = (header?: string): string | null => {
  const [scheme, token] = (header ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
};

/**
 * Global guard: every route requires a valid API key unless marked @Public().
 * Routes marked @Roles(...) additionally require one of those roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Missing API key');

    const apiKey = await this.auth.authenticate(token);
    if (!apiKey) throw new UnauthorizedException('Invalid API key');

    const roles = this.reflector.getAllAndOverride<ApiKeyRole[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (roles?.length && !roles.includes(apiKey.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    (request as unknown as Record<string, unknown>)[API_KEY_REQUEST_PROPERTY] =
      apiKey;
    return true;
  }
}
