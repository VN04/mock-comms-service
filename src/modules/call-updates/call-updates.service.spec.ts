import { makeEvent, mockConfig } from '../../common/testing/fixtures';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { CallUpdatesService } from './call-updates.service';

describe('CallUpdatesService', () => {
  const pipeline = { expire: jest.fn(), exec: jest.fn() };
  const multi = {
    set: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const client = {
    publish: jest.fn(),
    get: jest.fn(),
    smembers: jest.fn(),
    multi: () => multi,
    pipeline: () => pipeline,
  };
  const service = new CallUpdatesService(
    { client } as unknown as RedisService,
    mockConfig({ wsToken: { ttlSeconds: 3600, graceSeconds: 300 } }),
  );

  beforeEach(() => jest.clearAllMocks());

  it('publishes events on the shared pub/sub channel', async () => {
    const event = makeEvent();
    await service.publish(event);
    expect(client.publish).toHaveBeenCalledWith(
      'channel:call-updates',
      JSON.stringify(event),
    );
  });

  it('issues a random token scoped to one call', async () => {
    const a = await service.issueToken({ callId: 'c1', apiKeyId: 'k1' });
    const b = await service.issueToken({ callId: 'c1', apiKeyId: 'k1' });

    expect(a.token).not.toEqual(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(multi.set).toHaveBeenCalledWith(
      `ws-token:${a.token}`,
      JSON.stringify({ callId: 'c1', apiKeyId: 'k1' }),
      'EX',
      3600,
    );
    expect(multi.sadd).toHaveBeenCalledWith('call:c1:ws-tokens', a.token);
  });

  it('resolves valid tokens and rejects unknown ones', async () => {
    client.get.mockResolvedValueOnce(
      JSON.stringify({ callId: 'c1', apiKeyId: 'k1' }),
    );
    await expect(service.resolveToken('t')).resolves.toEqual({
      callId: 'c1',
      apiKeyId: 'k1',
    });
    client.get.mockResolvedValueOnce(null);
    await expect(service.resolveToken('t')).resolves.toBeNull();
  });

  it('only ever shortens token TTLs to the grace period on completion', async () => {
    client.smembers.mockResolvedValue(['t1', 't2']);
    await service.expireTokensForCall('c1');
    expect(pipeline.expire).toHaveBeenCalledWith('ws-token:t1', 300, 'LT');
    expect(pipeline.expire).toHaveBeenCalledWith('ws-token:t2', 300, 'LT');
    expect(pipeline.expire).toHaveBeenCalledWith(
      'call:c1:ws-tokens',
      300,
      'LT',
    );
  });
});
