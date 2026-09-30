import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { makeApiKey, mockConfig } from '../../common/testing/fixtures';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

describe('CallsController', () => {
  const calls = { create: jest.fn(), get: jest.fn(), issueWsToken: jest.fn() };
  const req = {
    protocol: 'http',
    get: () => 'localhost:3000',
  } as unknown as Request;
  const res = () =>
    ({ status: jest.fn(), setHeader: jest.fn() }) as unknown as Response & {
      status: jest.Mock;
      setHeader: jest.Mock;
    };
  const dto = { from: '+14155550100', to: '+14155550101' };

  const controller = (publicBaseUrl?: string) =>
    new CallsController(
      calls as unknown as CallsService,
      mockConfig({ app: { publicBaseUrl } }),
    );

  beforeEach(() => jest.clearAllMocks());

  it('returns 201 for a new call, deriving the base URL from the request', async () => {
    calls.create.mockResolvedValue({
      response: { call_id: 'c1' },
      replayed: false,
    });
    const response = res();

    await controller().create(makeApiKey(), dto, undefined, req, response);

    expect(calls.create).toHaveBeenCalledWith(makeApiKey(), dto, {
      idempotencyKey: undefined,
      baseUrl: 'http://localhost:3000',
    });
    expect(response.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('returns 200 + Idempotent-Replayed for a replay, honouring PUBLIC_BASE_URL', async () => {
    calls.create.mockResolvedValue({
      response: { call_id: 'c1' },
      replayed: true,
    });
    const response = res();

    await controller('https://api.example.com').create(
      makeApiKey(),
      dto,
      'k1',
      req,
      response,
    );

    expect(calls.create).toHaveBeenCalledWith(makeApiKey(), dto, {
      idempotencyKey: 'k1',
      baseUrl: 'https://api.example.com',
    });
    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Idempotent-Replayed',
      'true',
    );
  });
});
