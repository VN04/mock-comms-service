import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

/** A named Lua script. ioredis caches it server-side and runs it via EVALSHA. */
export interface LuaScript {
  name: string;
  lua: string;
  numberOfKeys: number;
}

type ScriptCommand = (...args: (string | number)[]) => Promise<unknown>;

/**
 * Owns the shared Redis connection used for commands and Lua scripts.
 * Subscribers need a dedicated connection, so they are created on demand.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private readonly subscribers: Redis[] = [];
  private readonly definedScripts = new Set<string>();

  constructor(config: ConfigService<AppConfig, true>) {
    this.client = new Redis(config.get('redis.url', { infer: true }), {
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
  }

  /** Runs a Lua script atomically (EVALSHA with automatic script loading). */
  async runScript<T>(
    script: LuaScript,
    keys: string[],
    args: (string | number)[],
  ): Promise<T> {
    if (!this.definedScripts.has(script.name)) {
      this.client.defineCommand(script.name, {
        lua: script.lua,
        numberOfKeys: script.numberOfKeys,
      });
      this.definedScripts.add(script.name);
    }
    const command = (this.client as unknown as Record<string, ScriptCommand>)[
      script.name
    ];
    return (await command.call(this.client, ...keys, ...args)) as T;
  }

  /** New connection dedicated to pub/sub (a subscribed connection can't run commands). */
  createSubscriber(): Redis {
    const subscriber = this.client.duplicate();
    this.subscribers.push(subscriber);
    return subscriber;
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  /** Closed last (after other modules' shutdown hooks may still need Redis). */
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.subscribers, this.client].map((c) => c.quit()),
    );
  }
}
