/**
 * Atomically enforces BOTH per-API-key limits and reserves a slot.
 *
 * Checks every limit before writing anything, so a rejected request leaves no
 * trace (no rollback needed) and concurrent requests cannot race past a limit.
 *
 * KEYS[1] active-calls ZSET  (member = callId, score = reserved-at ms)
 * KEYS[2] CPS window ZSET     (member = callId, score = request ms)
 * ARGV[1] callId
 * ARGV[2] max concurrent calls
 * ARGV[3] max calls per second
 * ARGV[4] stale-slot age in ms (leaked slots older than this are pruned)
 *
 * Returns {1, 'OK'} or {0, 'CONCURRENCY' | 'CPS'}.
 */
export const RESERVE_CALL_SLOT_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local maxConcurrent = tonumber(ARGV[2])
local maxCps = tonumber(ARGV[3])
local staleAfter = tonumber(ARGV[4])

-- Sliding window: forget requests older than 1s; prune leaked active slots.
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - staleAfter)

if redis.call('ZCARD', KEYS[1]) >= maxConcurrent then
  return {0, 'CONCURRENCY'}
end
if redis.call('ZCARD', KEYS[2]) >= maxCps then
  return {0, 'CPS'}
end

redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[1], staleAfter)
redis.call('PEXPIRE', KEYS[2], 1000)
return {1, 'OK'}
`;
