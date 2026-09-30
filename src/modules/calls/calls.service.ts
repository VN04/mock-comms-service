import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiKeyContext, ApiKeyRole } from '../../common/auth/api-key-context';
import { CallRecord } from '../../common/call/call-record';
import { CallStatus } from '../../common/call/call-status';
import { WS_CALLS_PATH } from '../../common/constants/routes';
import { CallRepository } from '../../infrastructure/database/repositories/call.repository';
import { CallStateRepository } from '../../infrastructure/redis/repositories/call-state.repository';
import { CALL_PROVIDER } from '../call-provider/call-provider.interface';
import type { CallProvider } from '../call-provider/call-provider.interface';
import { CallUpdatesService } from '../call-updates/call-updates.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { MetricsService } from '../metrics/metrics.service';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import { CallPresenter } from './call.presenter';
import {
  CallResponse,
  CreateCallResponse,
  WsTokenResponse,
} from './dto/call-response.dto';
import { CreateCallDto } from './dto/create-call.dto';

export interface CreateCallOptions {
  idempotencyKey?: string;
  /** Public base URL of this API (used to build the WebSocket URL). */
  baseUrl: string;
}

export interface CreateCallResult {
  response: CreateCallResponse;
  /** True when an Idempotency-Key matched an earlier request. */
  replayed: boolean;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly callState: CallStateRepository,
    private readonly calls: CallRepository,
    private readonly rateLimiter: RateLimiterService,
    private readonly idempotency: IdempotencyService,
    private readonly callUpdates: CallUpdatesService,
    private readonly metrics: MetricsService,
    private readonly presenter: CallPresenter,
    @Inject(CALL_PROVIDER) private readonly provider: CallProvider,
  ) {}

  /**
   * Hot path — Redis only, no MySQL round trip:
   * idempotency claim → rate-limit reservation → store QUEUED state →
   * hand to provider (async progression) → issue a WebSocket token.
   */
  async create(
    apiKey: ApiKeyContext,
    dto: CreateCallDto,
    options: CreateCallOptions,
  ): Promise<CreateCallResult> {
    const { idempotencyKey } = options;
    if (idempotencyKey) {
      const claim = await this.idempotency.claim(apiKey.id, idempotencyKey);
      if (claim.status === 'completed') {
        const existing = await this.findAccessible(apiKey, claim.resourceId);
        return {
          response: await this.buildCreateResponse(
            existing,
            apiKey,
            options.baseUrl,
          ),
          replayed: true,
        };
      }
    }

    try {
      const call = await this.startCall(apiKey, dto);
      if (idempotencyKey) {
        await this.idempotency.complete(apiKey.id, idempotencyKey, call.id);
      }
      return {
        response: await this.buildCreateResponse(call, apiKey, options.baseUrl),
        replayed: false,
      };
    } catch (err) {
      // Let the client retry with the same key (e.g. after a 429).
      if (idempotencyKey)
        await this.idempotency.release(apiKey.id, idempotencyKey);
      throw err;
    }
  }

  async get(apiKey: ApiKeyContext, callId: string): Promise<CallResponse> {
    return this.presenter.present(await this.findAccessible(apiKey, callId));
  }

  /** New WebSocket token for an existing call (e.g. to reconnect later). */
  async issueWsToken(
    apiKey: ApiKeyContext,
    callId: string,
    baseUrl: string,
  ): Promise<WsTokenResponse> {
    const call = await this.findAccessible(apiKey, callId);
    const { ws_url, ws_token_expires_at } = await this.buildCreateResponse(
      call,
      apiKey,
      baseUrl,
    );
    return { ws_url, ws_token_expires_at };
  }

  /**
   * Live state from Redis, falling back to MySQL once the call has expired
   * from Redis. Admins can read any call; clients only their own (404
   * otherwise, so call IDs of other tenants aren't disclosed).
   */
  async findAccessible(
    apiKey: ApiKeyContext,
    callId: string,
  ): Promise<CallRecord> {
    const call = await this.findById(callId);
    if (
      !call ||
      (apiKey.role !== ApiKeyRole.ADMIN && call.apiKeyId !== apiKey.id)
    ) {
      throw new NotFoundException('Call not found');
    }
    return call;
  }

  /** Unscoped lookup for internal callers that have already authorized access. */
  async findById(callId: string): Promise<CallRecord | null> {
    return (
      (await this.callState.get(callId)) ?? (await this.calls.findById(callId))
    );
  }

  private async startCall(
    apiKey: ApiKeyContext,
    dto: CreateCallDto,
  ): Promise<CallRecord> {
    const now = Date.now();
    const record: CallRecord = {
      id: randomUUID(),
      apiKeyId: apiKey.id,
      from: dto.from,
      to: dto.to,
      metadata: dto.metadata ?? null,
      status: CallStatus.QUEUED,
      outcome: null,
      provider: this.provider.name,
      queuedAt: now,
      ringingAt: null,
      answeredAt: null,
      unansweredAt: null,
      completedAt: null,
      recordingStatus: null,
      recordingKey: null,
      recordingUrl: null,
      recordingUploadedAt: null,
      updatedAt: now,
      lastSequence: null,
    };

    await this.rateLimiter.reserve(apiKey, record.id); // throws 429
    try {
      const result = await this.callState.create(record);
      if (!result.applied) throw new Error(`Call ${record.id} already exists`);
      await this.callUpdates.publish(result.event);
      // Metrics must never fail a call.
      await this.metrics
        .recordCallCreated(apiKey.id)
        .catch((e: Error) => this.logger.warn(`metrics: ${e.message}`));
      await this.provider.dial(result.call);
      return result.call;
    } catch (err) {
      this.logger.error(
        `Failed to start call ${record.id}: ${(err as Error).message}`,
      );
      await this.rateLimiter.release(apiKey.id, record.id);
      throw err;
    }
  }

  private async buildCreateResponse(
    call: CallRecord,
    apiKey: ApiKeyContext,
    baseUrl: string,
  ): Promise<CreateCallResponse> {
    const { token, expiresAt } = await this.callUpdates.issueToken({
      callId: call.id,
      apiKeyId: apiKey.id,
    });
    const wsBase = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    return {
      call_id: call.id,
      status: call.status,
      ws_url: `${wsBase}${WS_CALLS_PATH}/${call.id}?token=${token}`,
      ws_token_expires_at: expiresAt.toISOString(),
    };
  }
}
