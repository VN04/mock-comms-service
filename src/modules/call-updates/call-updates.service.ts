import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { CallEvent } from '../../common/call/call-event';
import { RedisChannels, RedisKeys } from '../../common/constants/redis-keys';
import { AppConfig } from '../../config/configuration';
import { RedisService } from '../../infrastructure/redis/redis.service';

export interface WsTokenClaims {
  callId: string;
  apiKeyId: string;
}

export interface IssuedWsToken {
  token: string;
  expiresAt: Date;
}

/**
 * Real-time plumbing shared by the API and the worker:
 *  - publishes call events on Redis pub/sub (every API instance relays them
 *    to its WebSocket clients, so this works with N replicas);
 *  - issues/validates short-lived per-call WebSocket tokens, so the long-lived
 *    API key never has to appear in a URL.
 */
@Injectable()
export class CallUpdatesService {
  private readonly tokenTtlSeconds: number;
  private readonly tokenGraceSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<AppConfig, true>,
  ) {
    const ws = config.get('wsToken', { infer: true });
    this.tokenTtlSeconds = ws.ttlSeconds;
    this.tokenGraceSeconds = ws.graceSeconds;
  }

  async publish(event: CallEvent): Promise<void> {
    await this.redis.client.publish(
      RedisChannels.callUpdates,
      JSON.stringify(event),
    );
  }

  /**
   * Issues a random opaque token that ONLY grants read access to this call's
   * updates. It stays valid well beyond the call's lifetime; once the call
   * completes it is shortened to a grace period (see expireTokensForCall).
   */
  async issueToken(claims: WsTokenClaims): Promise<IssuedWsToken> {
    const token = randomBytes(32).toString('base64url');
    const setKey = RedisKeys.callWsTokens(claims.callId);
    await this.redis.client
      .multi()
      .set(
        RedisKeys.wsToken(token),
        JSON.stringify(claims),
        'EX',
        this.tokenTtlSeconds,
      )
      .sadd(setKey, token)
      .expire(setKey, this.tokenTtlSeconds)
      .exec();
    return {
      token,
      expiresAt: new Date(Date.now() + this.tokenTtlSeconds * 1000),
    };
  }

  async resolveToken(token: string): Promise<WsTokenClaims | null> {
    const raw = await this.redis.client.get(RedisKeys.wsToken(token));
    return raw ? (JSON.parse(raw) as WsTokenClaims) : null;
  }

  /**
   * Called when a call completes: tokens are cut down to a short grace period
   * (enough to reconnect and receive the recording event). Open sockets are
   * unaffected — tokens are only checked at connection time.
   */
  async expireTokensForCall(callId: string): Promise<void> {
    const setKey = RedisKeys.callWsTokens(callId);
    const tokens = await this.redis.client.smembers(setKey);
    const pipeline = this.redis.client.pipeline();
    for (const token of tokens) {
      // 'LT' only ever shortens a TTL — never extends it (Redis >= 7).
      pipeline.expire(RedisKeys.wsToken(token), this.tokenGraceSeconds, 'LT');
    }
    pipeline.expire(setKey, this.tokenGraceSeconds, 'LT');
    await pipeline.exec();
  }
}
