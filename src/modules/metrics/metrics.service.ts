import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { CallOutcome } from '../../common/call/call-status';
import { Queues } from '../../common/constants/queues';
import { RedisKeys } from '../../common/constants/redis-keys';
import { RedisService } from '../../infrastructure/redis/redis.service';

export type RateLimitReason = 'CPS' | 'CONCURRENCY';
export type UploadResult = 'succeeded' | 'failed';

export interface MetricsSnapshot {
  total_calls: number;
  active_calls: number;
  /** New calls created during the last full second (platform-wide). */
  cps: number;
  /** Average new calls/second over the last 10 full seconds. */
  cps_avg_10s: number;
  completed_calls: { answered: number; unanswered: number };
  uploads: { succeeded: number; failed: number; pending: number };
  rate_limit_rejections: { cps: number; concurrency: number };
}

const CPS_WINDOW_SECONDS = 10;
/** Per-second buckets are kept a little longer than the averaging window. */
const CPS_BUCKET_TTL_SECONDS = CPS_WINDOW_SECONDS + 5;

const int = (v: string | null | undefined): number => Number(v ?? 0);

/** The Prometheus metric objects exposed on /metrics/prometheus. */
function createPromMetrics(registry: Registry) {
  collectDefaultMetrics({ register: registry });
  const registers = [registry];
  return {
    callsTotal: new Counter({
      name: 'calls_created_total',
      help: 'Calls created, by API key',
      labelNames: ['api_key_id'],
      registers,
    }),
    callsActive: new Gauge({
      name: 'calls_active',
      help: 'Calls not yet COMPLETED',
      registers,
    }),
    cps: new Gauge({
      name: 'calls_per_second',
      help: 'New calls in the last full second',
      registers,
    }),
    completed: new Counter({
      name: 'calls_completed_total',
      help: 'Completed calls by outcome',
      labelNames: ['outcome'],
      registers,
    }),
    uploads: new Counter({
      name: 'recording_uploads_total',
      help: 'Recording uploads by result',
      labelNames: ['result'],
      registers,
    }),
    uploadsPending: new Gauge({
      name: 'recording_uploads_pending',
      help: 'Recording uploads waiting, delayed or in progress',
      registers,
    }),
    rejections: new Counter({
      name: 'rate_limit_rejections_total',
      help: 'Rejected call attempts by limit type',
      labelNames: ['reason'],
      registers,
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers,
    }),
  };
}

/**
 * Platform metrics. Counters live in Redis (not process memory) so every API
 * instance and the worker contribute to — and report — the same numbers.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly prom = createPromMetrics(this.registry);

  constructor(
    private readonly redis: RedisService,
    @InjectQueue(Queues.RECORDINGS) private readonly recordingsQueue: Queue,
  ) {}

  async recordCallCreated(apiKeyId: string): Promise<void> {
    const bucket = RedisKeys.metrics.callsCreatedPerSecond(epochSecond());
    await this.redis.client
      .multi()
      .incr(bucket)
      .expire(bucket, CPS_BUCKET_TTL_SECONDS)
      .hincrby(RedisKeys.metrics.callsByApiKey, apiKeyId, 1)
      .exec();
  }

  async recordCallCompleted(outcome: CallOutcome | null): Promise<void> {
    await this.redis.client.hincrby(
      RedisKeys.metrics.callsCompleted,
      (outcome ?? 'unknown').toLowerCase(),
      1,
    );
  }

  async recordRateLimitRejection(reason: RateLimitReason): Promise<void> {
    await this.redis.client.hincrby(
      RedisKeys.metrics.rateLimitRejections,
      reason.toLowerCase(),
      1,
    );
  }

  async recordUpload(result: UploadResult): Promise<void> {
    await this.redis.client.hincrby(RedisKeys.metrics.uploads, result, 1);
  }

  /** Per-instance latency histogram (Prometheus aggregates across instances). */
  observeHttpRequest(
    method: string,
    route: string,
    status: number,
    seconds: number,
  ): void {
    this.prom.httpDuration.observe(
      { method, route, status: String(status) },
      seconds,
    );
  }

  async getSnapshot(): Promise<MetricsSnapshot> {
    const now = epochSecond();
    // Buckets for the last N *completed* seconds (the current one is partial).
    const buckets = Array.from({ length: CPS_WINDOW_SECONDS }, (_, i) =>
      RedisKeys.metrics.callsCreatedPerSecond(now - 1 - i),
    );
    const m = RedisKeys.metrics;
    const [[total, active, perSecond, completed, uploads, rejections], jobs] =
      await Promise.all([
        Promise.all([
          this.redis.client.get(m.callsTotal),
          this.redis.client.zcard(RedisKeys.activeCalls),
          this.redis.client.mget(...buckets),
          this.redis.client.hgetall(m.callsCompleted),
          this.redis.client.hgetall(m.uploads),
          this.redis.client.hgetall(m.rateLimitRejections),
        ]),
        this.recordingsQueue.getJobCounts('waiting', 'active', 'delayed'),
      ]);

    const windowTotal = perSecond.reduce((sum, v) => sum + int(v), 0);
    return {
      total_calls: int(total),
      active_calls: active,
      cps: int(perSecond[0]),
      cps_avg_10s: Math.round((windowTotal / CPS_WINDOW_SECONDS) * 100) / 100,
      completed_calls: {
        answered: int(completed.answered),
        unanswered: int(completed.unanswered),
      },
      uploads: {
        succeeded: int(uploads.succeeded),
        failed: int(uploads.failed),
        pending: (jobs.waiting ?? 0) + (jobs.active ?? 0) + (jobs.delayed ?? 0),
      },
      rate_limit_rejections: {
        cps: int(rejections.cps),
        concurrency: int(rejections.concurrency),
      },
    };
  }

  /** Prometheus text exposition, refreshed from Redis on every scrape. */
  async renderPrometheus(): Promise<{ contentType: string; body: string }> {
    const [snapshot, byKey] = await Promise.all([
      this.getSnapshot(),
      this.redis.client.hgetall(RedisKeys.metrics.callsByApiKey),
    ]);
    const p = this.prom;

    p.callsTotal.reset();
    for (const [apiKeyId, count] of Object.entries(byKey)) {
      p.callsTotal.inc({ api_key_id: apiKeyId }, int(count));
    }
    p.callsActive.set(snapshot.active_calls);
    p.cps.set(snapshot.cps);
    setCounter(
      p.completed,
      { outcome: 'answered' },
      snapshot.completed_calls.answered,
    );
    setCounter(
      p.completed,
      { outcome: 'unanswered' },
      snapshot.completed_calls.unanswered,
    );
    setCounter(p.uploads, { result: 'succeeded' }, snapshot.uploads.succeeded);
    setCounter(p.uploads, { result: 'failed' }, snapshot.uploads.failed);
    p.uploadsPending.set(snapshot.uploads.pending);
    setCounter(
      p.rejections,
      { reason: 'cps' },
      snapshot.rate_limit_rejections.cps,
    );
    setCounter(
      p.rejections,
      { reason: 'concurrency' },
      snapshot.rate_limit_rejections.concurrency,
    );

    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }
}

const epochSecond = (): number => Math.floor(Date.now() / 1000);

/** Counters are sourced from Redis, so mirror the absolute value on each scrape. */
function setCounter<T extends string>(
  counter: Counter<T>,
  labels: Partial<Record<T, string>>,
  value: number,
): void {
  counter.remove(labels);
  counter.inc(labels, value);
}
