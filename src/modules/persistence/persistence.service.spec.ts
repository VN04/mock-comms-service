import { CallEventType } from '../../common/call/call-event';
import { newCallHash } from '../../common/call/call-record';
import { CallStatus } from '../../common/call/call-status';
import { makeCall, makeEvent, mockConfig } from '../../common/testing/fixtures';
import { CallEventRepository } from '../../infrastructure/database/repositories/call-event.repository';
import { CallRepository } from '../../infrastructure/database/repositories/call.repository';
import { TransactionRunner } from '../../infrastructure/database/transaction.runner';
import {
  CallEventStreamRepository,
  StreamEntry,
} from '../../infrastructure/redis/repositories/call-event-stream.repository';
import { PersistenceService } from './persistence.service';

describe('PersistenceService', () => {
  const stream = {
    ensureGroup: jest.fn(),
    readBatch: jest.fn(),
    ack: jest.fn(),
  };
  const calls = { upsertMany: jest.fn() };
  const callEvents = { insertMany: jest.fn() };
  const manager = {};
  const tx = {
    run: jest.fn((work: (m: unknown) => Promise<unknown>) => work(manager)),
  };
  let service: PersistenceService;

  const entry = (
    id: string,
    sequence: number,
    snapshotStatus?: CallStatus,
  ): StreamEntry => ({
    id,
    event: makeEvent({ sequence, type: CallEventType.STATUS_CHANGED }),
    snapshot: snapshotStatus
      ? { ...newCallHash(makeCall()), status: snapshotStatus }
      : null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PersistenceService(
      stream as unknown as CallEventStreamRepository,
      calls as unknown as CallRepository,
      callEvents as unknown as CallEventRepository,
      tx as unknown as TransactionRunner,
      mockConfig({ persistence: { batchSize: 3 } }),
    );
  });

  it('does nothing when the stream is empty', async () => {
    stream.readBatch.mockResolvedValue([]);
    await expect(service.flush()).resolves.toEqual({ events: 0, calls: 0 });
    expect(tx.run).not.toHaveBeenCalled();
  });

  it('writes all events but only the latest snapshot per call, then acks', async () => {
    stream.readBatch.mockResolvedValueOnce([
      entry('1-0', 1, CallStatus.QUEUED),
      entry('2-0', 2),
      entry('3-0', 3, CallStatus.COMPLETED),
    ]);
    stream.readBatch.mockResolvedValueOnce([]);

    const result = await service.flush();

    expect(result).toEqual({ events: 3, calls: 1 });
    const [upserted] = calls.upsertMany.mock.calls[0] as [
      { status: CallStatus }[],
    ];
    expect(upserted).toHaveLength(1);
    expect(upserted[0].status).toBe(CallStatus.COMPLETED); // last snapshot wins
    expect(callEvents.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ sequence: 2 })]),
      manager,
    );
    expect(stream.ack).toHaveBeenCalledWith(['1-0', '2-0', '3-0']);
  });

  it('upserts calls before inserting events (FK order) in one transaction', async () => {
    const order: string[] = [];
    calls.upsertMany.mockImplementation(() => order.push('calls'));
    callEvents.insertMany.mockImplementation(() => order.push('events'));
    stream.readBatch.mockResolvedValueOnce([
      entry('1-0', 1, CallStatus.QUEUED),
    ]);

    await service.flush();
    expect(order).toEqual(['calls', 'events']);
    expect(tx.run).toHaveBeenCalledTimes(1);
  });

  it('does not ack when the write fails (entries are redelivered)', async () => {
    stream.readBatch.mockResolvedValueOnce([
      entry('1-0', 1, CallStatus.QUEUED),
    ]);
    tx.run.mockRejectedValueOnce(new Error('db down'));

    await expect(service.flush()).rejects.toThrow('db down');
    expect(stream.ack).not.toHaveBeenCalled();
  });

  it('keeps draining while batches are full', async () => {
    stream.readBatch
      .mockResolvedValueOnce([
        entry('1-0', 1),
        entry('2-0', 2),
        entry('3-0', 3),
      ])
      .mockResolvedValueOnce([entry('4-0', 4)]);

    await expect(service.flush()).resolves.toEqual({ events: 4, calls: 0 });
    expect(stream.readBatch).toHaveBeenCalledTimes(2);
  });

  it('creates the consumer group only once', async () => {
    stream.readBatch.mockResolvedValue([]);
    await service.flush();
    await service.flush();
    expect(stream.ensureGroup).toHaveBeenCalledTimes(1);
  });
});
