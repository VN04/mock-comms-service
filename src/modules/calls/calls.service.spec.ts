import { NotFoundException } from '@nestjs/common';
import { ApiKeyRole } from '../../common/auth/api-key-context';
import { CallStatus } from '../../common/call/call-status';
import { makeApiKey, makeCall, makeEvent } from '../../common/testing/fixtures';
import { CallRepository } from '../../infrastructure/database/repositories/call.repository';
import { CallStateRepository } from '../../infrastructure/redis/repositories/call-state.repository';
import { CallUpdatesService } from '../call-updates/call-updates.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  RateLimiterService,
  RateLimitExceededException,
} from '../rate-limiter/rate-limiter.service';
import { CallPresenter } from './call.presenter';
import { CallsService } from './calls.service';

describe('CallsService', () => {
  const callState = { create: jest.fn(), get: jest.fn() };
  const calls = { findById: jest.fn() };
  const rateLimiter = { reserve: jest.fn(), release: jest.fn() };
  const idempotency = {
    claim: jest.fn(),
    complete: jest.fn(),
    release: jest.fn(),
  };
  const callUpdates = { publish: jest.fn(), issueToken: jest.fn() };
  const metrics = { recordCallCreated: jest.fn() };
  const presenter = { present: jest.fn() };
  const provider = { name: 'mock', dial: jest.fn() };
  const apiKey = makeApiKey();
  const dto = { from: '+14155550100', to: '+14155550101' };
  const opts = { baseUrl: 'https://api.example.com' };
  let service: CallsService;

  beforeEach(() => {
    jest.resetAllMocks(); // also drops per-test mockRejectedValue implementations
    metrics.recordCallCreated.mockResolvedValue(undefined);
    callUpdates.issueToken.mockResolvedValue({
      token: 'tok',
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    callState.create.mockImplementation((record) =>
      Promise.resolve({ applied: true, call: record, event: makeEvent() }),
    );
    service = new CallsService(
      callState as unknown as CallStateRepository,
      calls as unknown as CallRepository,
      rateLimiter as unknown as RateLimiterService,
      idempotency as unknown as IdempotencyService,
      callUpdates as unknown as CallUpdatesService,
      metrics as unknown as MetricsService,
      presenter as unknown as CallPresenter,
      provider,
    );
  });

  describe('create', () => {
    it('reserves a slot, stores the call, dials, and returns a WS URL', async () => {
      const { response, replayed } = await service.create(apiKey, dto, opts);

      expect(replayed).toBe(false);
      expect(response.status).toBe(CallStatus.QUEUED);
      expect(response.ws_url).toBe(
        `wss://api.example.com/ws/calls/${response.call_id}?token=tok`,
      );
      expect(rateLimiter.reserve).toHaveBeenCalledWith(
        apiKey,
        response.call_id,
      );
      expect(callState.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: response.call_id,
          apiKeyId: apiKey.id,
          provider: 'mock',
          status: CallStatus.QUEUED,
        }),
      );
      expect(provider.dial).toHaveBeenCalled();
      expect(metrics.recordCallCreated).toHaveBeenCalledWith(apiKey.id);
    });

    it('propagates 429 without storing anything', async () => {
      rateLimiter.reserve.mockRejectedValue(
        new RateLimitExceededException('CPS'),
      );

      await expect(service.create(apiKey, dto, opts)).rejects.toBeInstanceOf(
        RateLimitExceededException,
      );
      expect(callState.create).not.toHaveBeenCalled();
      expect(provider.dial).not.toHaveBeenCalled();
    });

    it('releases the slot if the call cannot be started', async () => {
      provider.dial.mockRejectedValueOnce(new Error('queue down'));

      await expect(service.create(apiKey, dto, opts)).rejects.toThrow(
        'queue down',
      );
      expect(rateLimiter.release).toHaveBeenCalledWith(
        apiKey.id,
        expect.any(String),
      );
    });

    it('does not fail the call when metrics are unavailable', async () => {
      metrics.recordCallCreated.mockRejectedValue(new Error('redis blip'));
      await expect(service.create(apiKey, dto, opts)).resolves.toBeDefined();
    });

    describe('with Idempotency-Key', () => {
      it('stores the call ID after a successful create', async () => {
        idempotency.claim.mockResolvedValue({ status: 'claimed' });
        const { response } = await service.create(apiKey, dto, {
          ...opts,
          idempotencyKey: 'k1',
        });
        expect(idempotency.complete).toHaveBeenCalledWith(
          apiKey.id,
          'k1',
          response.call_id,
        );
      });

      it('replays the original call instead of creating another', async () => {
        const existing = makeCall({ status: CallStatus.RINGING });
        idempotency.claim.mockResolvedValue({
          status: 'completed',
          resourceId: existing.id,
        });
        callState.get.mockResolvedValue(existing);

        const { response, replayed } = await service.create(apiKey, dto, {
          ...opts,
          idempotencyKey: 'k1',
        });

        expect(replayed).toBe(true);
        expect(response.call_id).toBe(existing.id);
        expect(response.status).toBe(CallStatus.RINGING);
        expect(rateLimiter.reserve).not.toHaveBeenCalled();
      });

      it('releases the key when the request fails, allowing a retry', async () => {
        idempotency.claim.mockResolvedValue({ status: 'claimed' });
        rateLimiter.reserve.mockRejectedValue(
          new RateLimitExceededException('CPS'),
        );
        await expect(
          service.create(apiKey, dto, { ...opts, idempotencyKey: 'k1' }),
        ).rejects.toBeDefined();
        expect(idempotency.release).toHaveBeenCalledWith(apiKey.id, 'k1');
      });
    });
  });

  describe('findAccessible', () => {
    it('prefers live Redis state', async () => {
      const call = makeCall();
      callState.get.mockResolvedValue(call);
      await expect(service.findAccessible(apiKey, call.id)).resolves.toBe(call);
      expect(calls.findById).not.toHaveBeenCalled();
    });

    it('falls back to MySQL once the call left Redis', async () => {
      const call = makeCall();
      callState.get.mockResolvedValue(null);
      calls.findById.mockResolvedValue(call);
      await expect(service.findAccessible(apiKey, call.id)).resolves.toBe(call);
    });

    it("404s for another tenant's call", async () => {
      callState.get.mockResolvedValue(makeCall({ apiKeyId: 'someone-else' }));
      await expect(service.findAccessible(apiKey, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lets admins read any call', async () => {
      const call = makeCall({ apiKeyId: 'someone-else' });
      callState.get.mockResolvedValue(call);
      await expect(
        service.findAccessible(makeApiKey({ role: ApiKeyRole.ADMIN }), call.id),
      ).resolves.toBe(call);
    });

    it('404s for an unknown call', async () => {
      callState.get.mockResolvedValue(null);
      calls.findById.mockResolvedValue(null);
      await expect(service.findAccessible(apiKey, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
