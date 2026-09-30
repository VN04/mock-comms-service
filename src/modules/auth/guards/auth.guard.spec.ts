import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyRole } from '../../../common/auth/api-key-context';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../../../common/decorators/auth.decorators';
import { makeApiKey } from '../../../common/testing/fixtures';
import { AuthService } from '../auth.service';
import { AuthGuard, extractBearerToken } from './auth.guard';

describe('AuthGuard', () => {
  let auth: { authenticate: jest.Mock };
  let metadata: Record<string, unknown>;
  let guard: AuthGuard;

  const contextWith = (authorization?: string) => {
    const request: Record<string, unknown> = { headers: { authorization } };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  };

  beforeEach(() => {
    auth = { authenticate: jest.fn() };
    metadata = {};
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    guard = new AuthGuard(auth as unknown as AuthService, reflector);
  });

  it('lets @Public() routes through without a key', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(guard.canActivate(contextWith().ctx)).resolves.toBe(true);
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('rejects a missing key', async () => {
    await expect(guard.canActivate(contextWith().ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an invalid key', async () => {
    auth.authenticate.mockResolvedValue(null);
    await expect(
      guard.canActivate(contextWith('Bearer bad').ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the key context to the request', async () => {
    const apiKey = makeApiKey();
    auth.authenticate.mockResolvedValue(apiKey);
    const { ctx, request } = contextWith('Bearer good');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(auth.authenticate).toHaveBeenCalledWith('good');
    expect(request.apiKey).toBe(apiKey);
  });

  it('enforces @Roles()', async () => {
    metadata[ROLES_KEY] = [ApiKeyRole.ADMIN];
    auth.authenticate.mockResolvedValue(makeApiKey());
    await expect(
      guard.canActivate(contextWith('Bearer good').ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);

    auth.authenticate.mockResolvedValue(makeApiKey({ role: ApiKeyRole.ADMIN }));
    await expect(
      guard.canActivate(contextWith('Bearer good').ctx),
    ).resolves.toBe(true);
  });
});

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Basic abc', null],
    ['Bearer', null],
    [undefined, null],
  ])('%s → %s', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });
});
