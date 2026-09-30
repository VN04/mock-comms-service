import { Queue } from 'bullmq';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  const client = {
    get: jest.fn(),
    zcard: jest.fn(),
    mget: jest.fn(),
    hgetall: jest.fn(),
    hincrby: jest.fn(),
  };
  const queue = { getJobCounts: jest.fn() };
  let service: MetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MetricsService(
      { client } as unknown as RedisService,
      queue as unknown as Queue,
    );
    client.get.mockResolvedValue('120');
    client.zcard.mockResolvedValue(4);
    // Last 10 full seconds, newest first.
    client.mget.mockResolvedValue([
      '2',
      '1',
      null,
      '3',
      null,
      null,
      null,
      null,
      null,
      '4',
    ]);
    client.hgetall.mockImplementation((key: string) =>
      Promise.resolve(
        {
          'metrics:calls:completed': { answered: '70', unanswered: '46' },
          'metrics:uploads': { succeeded: '110', failed: '1' },
          'metrics:rate-limit-rejections': { cps: '9', concurrency: '2' },
          'metrics:calls:by-api-key': { 'key-1': '100', 'key-2': '20' },
        }[key] ?? {},
      ),
    );
    queue.getJobCounts.mockResolvedValue({ waiting: 1, active: 2, delayed: 1 });
  });

  it('aggregates the shared Redis counters into a snapshot', async () => {
    await expect(service.getSnapshot()).resolves.toEqual({
      total_calls: 120,
      active_calls: 4,
      cps: 2, // last full second
      cps_avg_10s: 1, // (2+1+3+4) / 10
      completed_calls: { answered: 70, unanswered: 46 },
      uploads: { succeeded: 110, failed: 1, pending: 4 },
      rate_limit_rejections: { cps: 9, concurrency: 2 },
    });
  });

  it('renders Prometheus exposition from the same counters', async () => {
    const { contentType, body } = await service.renderPrometheus();

    expect(contentType).toContain('text/plain');
    expect(body).toContain('calls_created_total{api_key_id="key-1"} 100');
    expect(body).toContain('calls_active 4');
    expect(body).toContain('calls_completed_total{outcome="answered"} 70');
    expect(body).toContain('recording_uploads_total{result="failed"} 1');
    expect(body).toContain('rate_limit_rejections_total{reason="cps"} 9');
  });

  it('mirrors absolute counter values on repeated scrapes (no double counting)', async () => {
    await service.renderPrometheus();
    const { body } = await service.renderPrometheus();
    expect(body).toContain('calls_active 4');
    expect(body).toContain('rate_limit_rejections_total{reason="cps"} 9');
  });

  it('counts rejections by lower-cased reason', async () => {
    await service.recordRateLimitRejection('CONCURRENCY');
    expect(client.hincrby).toHaveBeenCalledWith(
      'metrics:rate-limit-rejections',
      'concurrency',
      1,
    );
  });
});
