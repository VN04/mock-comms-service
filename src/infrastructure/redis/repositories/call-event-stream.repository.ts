import { Injectable } from '@nestjs/common';
import { CallEvent, parseCallEvent } from '../../../common/call/call-event';
import { CallHash } from '../../../common/call/call-record';
import {
  EVENT_STREAM_GROUP,
  RedisKeys,
} from '../../../common/constants/redis-keys';
import { RedisService } from '../redis.service';

export interface StreamEntry {
  id: string;
  event: CallEvent;
  /** Full call state, present on events that must upsert the `calls` row. */
  snapshot: CallHash | null;
}

type RawEntry = [id: string, fields: string[]];

/** Entries a crashed consumer read but never acked are reclaimed after this. */
const RECLAIM_IDLE_MS = 30_000;

/**
 * Reads the global call-event stream through a consumer group, which gives
 * at-least-once delivery: entries stay pending until acked, and are reclaimed
 * if a worker dies mid-batch.
 */
@Injectable()
export class CallEventStreamRepository {
  constructor(private readonly redis: RedisService) {}

  /** Creates the consumer group (and stream) if missing. Safe to call repeatedly. */
  async ensureGroup(): Promise<void> {
    try {
      await this.redis.client.xgroup(
        'CREATE',
        RedisKeys.eventStream,
        EVENT_STREAM_GROUP,
        '0',
        'MKSTREAM',
      );
    } catch (err) {
      if (!(err as Error).message.includes('BUSYGROUP')) throw err;
    }
  }

  /** Returns up to `count` entries: stale pending ones first, then new ones. */
  async readBatch(consumer: string, count: number): Promise<StreamEntry[]> {
    const [, reclaimed] = (await this.redis.client.xautoclaim(
      RedisKeys.eventStream,
      EVENT_STREAM_GROUP,
      consumer,
      RECLAIM_IDLE_MS,
      '0',
      'COUNT',
      count,
    )) as [string, RawEntry[]];

    const remaining = count - reclaimed.length;
    let fresh: RawEntry[] = [];
    if (remaining > 0) {
      const reply = (await this.redis.client.xreadgroup(
        'GROUP',
        EVENT_STREAM_GROUP,
        consumer,
        'COUNT',
        remaining,
        'STREAMS',
        RedisKeys.eventStream,
        '>',
      )) as [string, RawEntry[]][] | null;
      fresh = reply?.[0]?.[1] ?? [];
    }

    return [...reclaimed, ...fresh]
      .filter(([, fields]) => fields) // trimmed entries come back as null
      .map(([id, fields]) => toStreamEntry(id, fields));
  }

  async ack(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.redis.client.xack(
      RedisKeys.eventStream,
      EVENT_STREAM_GROUP,
      ...ids,
    );
  }
}

function toStreamEntry(id: string, fields: string[]): StreamEntry {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
  return {
    id,
    event: parseCallEvent(map.event),
    snapshot: map.snapshot ? (JSON.parse(map.snapshot) as CallHash) : null,
  };
}
