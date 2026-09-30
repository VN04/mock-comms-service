import { NotFoundException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { makeApiKey, makeCall } from '../../common/testing/fixtures';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuthService } from '../auth/auth.service';
import { CallPresenter } from '../calls/call.presenter';
import { CallsService } from '../calls/calls.service';
import { CallUpdatesGateway, HandshakeError } from './call-updates.gateway';
import { CallUpdatesService } from './call-updates.service';

const CALL_ID = '11111111-1111-4111-8111-111111111111';
const request = (url: string, authorization?: string) =>
  ({ url, headers: { authorization } }) as IncomingMessage;

describe('CallUpdatesGateway.authorize (handshake)', () => {
  const callUpdates = { resolveToken: jest.fn() };
  const auth = { authenticate: jest.fn() };
  const calls = { findAccessible: jest.fn() };
  const gateway = new CallUpdatesGateway(
    {} as HttpAdapterHost,
    {} as RedisService,
    callUpdates as unknown as CallUpdatesService,
    auth as unknown as AuthService,
    calls as unknown as CallsService,
    {} as CallPresenter,
  );

  const expectStatus = async (promise: Promise<unknown>, status: number) => {
    await expect(promise).rejects.toBeInstanceOf(HandshakeError);
    await promise.catch((e: HandshakeError) => expect(e.status).toBe(status));
  };

  beforeEach(() => jest.clearAllMocks());

  it('404s for paths outside /ws/calls/:uuid', async () => {
    await expectStatus(gateway.authorize(request('/ws/other')), 404);
    await expectStatus(gateway.authorize(request('/ws/calls/not-a-uuid')), 404);
  });

  it('accepts a per-call token for the matching call', async () => {
    callUpdates.resolveToken.mockResolvedValue({
      callId: CALL_ID,
      apiKeyId: 'k1',
    });
    await expect(
      gateway.authorize(request(`/ws/calls/${CALL_ID}?token=abc`)),
    ).resolves.toBe(CALL_ID);
    expect(callUpdates.resolveToken).toHaveBeenCalledWith('abc');
  });

  it('rejects a token issued for a different call', async () => {
    callUpdates.resolveToken.mockResolvedValue({
      callId: 'other',
      apiKeyId: 'k1',
    });
    await expectStatus(
      gateway.authorize(request(`/ws/calls/${CALL_ID}?token=abc`)),
      401,
    );
  });

  it('rejects expired/unknown tokens', async () => {
    callUpdates.resolveToken.mockResolvedValue(null);
    await expectStatus(
      gateway.authorize(request(`/ws/calls/${CALL_ID}?token=abc`)),
      401,
    );
  });

  it('accepts an API key header for a call the key can see', async () => {
    auth.authenticate.mockResolvedValue(makeApiKey());
    calls.findAccessible.mockResolvedValue(makeCall());
    await expect(
      gateway.authorize(request(`/ws/calls/${CALL_ID}`, 'Bearer key')),
    ).resolves.toBe(CALL_ID);
  });

  it("hides other tenants' calls behind 404", async () => {
    auth.authenticate.mockResolvedValue(makeApiKey());
    calls.findAccessible.mockRejectedValue(new NotFoundException());
    await expectStatus(
      gateway.authorize(request(`/ws/calls/${CALL_ID}`, 'Bearer key')),
      404,
    );
  });

  it('401s without any credentials', async () => {
    await expectStatus(gateway.authorize(request(`/ws/calls/${CALL_ID}`)), 401);
  });
});
