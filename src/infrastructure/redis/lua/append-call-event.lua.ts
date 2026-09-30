/**
 * The ONLY way call state changes in Redis. In one atomic step it:
 *   1. validates the mode (create: must not exist; transition: compare-and-set
 *      on the current status; append: must exist),
 *   2. updates the call hash,
 *   3. assigns the next per-call sequence number,
 *   4. appends the event to the call's event list and the global stream
 *      (optionally with a full state snapshot for the persistence job),
 *   5. maintains the global active-call set, total counter and TTLs.
 *
 * Because state change and event are written together, a transition can never
 * happen without being recorded, and a retried job can never move a call
 * backwards.
 *
 * KEYS[1] call hash          KEYS[2] call event list
 * KEYS[3] event stream       KEYS[4] active-calls ZSET
 * KEYS[5] total-calls counter
 *
 * ARGV[1]  mode: 'create' | 'transition' | 'append'
 * ARGV[2]  callId
 * ARGV[3]  event type
 * ARGV[4]  from status ('' if n/a). For 'transition' it is the EXPECTED status.
 * ARGV[5]  to status ('' if n/a)
 * ARGV[6]  JSON object of hash fields to set
 * ARGV[7]  JSON payload ('' for none)
 * ARGV[8]  occurredAt (epoch ms)
 * ARGV[9]  '1' to attach a full state snapshot to the stream entry
 * ARGV[10] stream MAXLEN (approximate)
 * ARGV[11] finalize TTL seconds ('0' = call not finished). When > 0 the call
 *          leaves the active set and its keys expire after this many seconds.
 *
 * Returns {1, sequence, stateJson, eventJson} on success, or
 *         {0, 'EXISTS' | 'NOT_FOUND' | 'CONFLICT', currentStatus?}.
 */
export const APPEND_CALL_EVENT_LUA = `
local mode = ARGV[1]
local callId = ARGV[2]
local exists = redis.call('EXISTS', KEYS[1]) == 1

if mode == 'create' and exists then return {0, 'EXISTS'} end
if mode ~= 'create' and not exists then return {0, 'NOT_FOUND'} end
if mode == 'transition' then
  local current = redis.call('HGET', KEYS[1], 'status')
  if current ~= ARGV[4] then return {0, 'CONFLICT', current} end
end

local fields = cjson.decode(ARGV[6])
for field, value in pairs(fields) do
  redis.call('HSET', KEYS[1], field, tostring(value))
end
redis.call('HSET', KEYS[1], 'updated_at', ARGV[8])
local seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)

local event = {
  callId = callId,
  sequence = seq,
  type = ARGV[3],
  fromStatus = ARGV[4],
  toStatus = ARGV[5],
  occurredAt = tonumber(ARGV[8]),
}
if ARGV[7] ~= '' then event.payload = cjson.decode(ARGV[7]) end
local eventJson = cjson.encode(event)

local flat = redis.call('HGETALL', KEYS[1])
local state = {}
for i = 1, #flat, 2 do state[flat[i]] = flat[i + 1] end
local stateJson = cjson.encode(state)

redis.call('RPUSH', KEYS[2], eventJson)
if ARGV[9] == '1' then
  redis.call('XADD', KEYS[3], 'MAXLEN', '~', ARGV[10], '*', 'event', eventJson, 'snapshot', stateJson)
else
  redis.call('XADD', KEYS[3], 'MAXLEN', '~', ARGV[10], '*', 'event', eventJson)
end

if mode == 'create' then
  redis.call('ZADD', KEYS[4], ARGV[8], callId)
  redis.call('INCR', KEYS[5])
end

local finalizeTtl = tonumber(ARGV[11])
if finalizeTtl > 0 then
  redis.call('ZREM', KEYS[4], callId)
  redis.call('EXPIRE', KEYS[1], finalizeTtl)
  redis.call('EXPIRE', KEYS[2], finalizeTtl)
end

return {1, seq, stateJson, eventJson}
`;
