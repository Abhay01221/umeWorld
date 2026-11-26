// Redis runs this as one transaction, including the writes for both participants.
export const matchmaking = String.raw`
local base = KEYS[1]
local action, guest, session, now = ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4])
local data = cjson.decode(ARGV[5])
local presence = base .. 'online:v2'
local selfKey = base .. 'session:' .. session
local function read(key)
  local value = redis.call('GET', key)
  if value then return cjson.decode(value) end
end
local function write(key, value, ttl)
  redis.call('SETEX', key, ttl, cjson.encode(value))
end
local function pairKey(a, b)
  if a > b then a, b = b, a end
  return base .. 'avoid:' .. a .. ':' .. b
end
local function inbox(room, id)
  return base .. 'signals:' .. room .. ':' .. id
end
local function result(value) return cjson.encode(value) end
local function failure(status, error) return result({status = status, error = error}) end
local function rate(key, limit, window)
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, window) end
  return count <= limit
end
local function isBanned(id)
  return redis.call('EXISTS', base .. 'ban:' .. id) == 1
end

if action == 'status' or action == 'join' or action == 'poll' then
  if isBanned(guest) then return failure(403, 'This browser is restricted from chatting.') end
end
local function presenceKeys(tab)
  return base .. 'presence-tabs:' .. guest, base .. 'presence-closed:' .. guest .. ':' .. tab
end
if action == 'status' then
  if data.presenceId then
    local tabs, closed = presenceKeys(data.presenceId)
    if redis.call('EXISTS', closed) == 0 then
      local expires = now + 35000
      redis.call('ZREMRANGEBYSCORE', tabs, '-inf', now)
      redis.call('ZADD', tabs, expires, data.presenceId)
      redis.call('EXPIRE', tabs, 45)
      redis.call('ZADD', presence, 'GT', expires, guest)
      redis.call('EXPIRE', presence, 60)
    end
  end
  redis.call('ZREMRANGEBYSCORE', presence, '-inf', now)
  return result({online = redis.call('ZCARD', presence), country = data.country})
end
if action == 'presence-offline' then
  local tabs, closed = presenceKeys(data.presenceId)
  -- A delayed heartbeat must not bring back a tab that already left.
  redis.call('SETEX', closed, 45, '1')
  redis.call('ZREM', tabs, data.presenceId)
  redis.call('ZREMRANGEBYSCORE', tabs, '-inf', now)
  local remaining = redis.call('ZRANGE', tabs, -1, -1, 'WITHSCORES')
  if remaining[2] then redis.call('ZADD', presence, remaining[2], guest)
  else redis.call('ZREM', presence, guest) end
  return result({ok = true})
end

local self = read(selfKey)
if self and self.guest ~= guest then return failure(403, 'This session is unavailable.') end

if action == 'report' then
  local room = read(base .. 'room:' .. data.room)
  local target
  if room and room.a == session and room.guestA == guest then target = room.guestB end
  if room and room.b == session and room.guestB == guest then target = room.guestA end
  if not target then return failure(404, 'This chat is no longer available to report.') end
  local receipt = base .. 'reported:' .. data.room .. ':' .. guest
  if redis.call('EXISTS', receipt) == 1 then
    if data.avoid then redis.call('SETEX', pairKey(guest, target), 7776000, '1') end
    return result({ok = true})
  end
  if not rate(base .. 'report-rate:' .. guest, 12, 3600) then
    return failure(429, 'You have sent several reports. Try again later.')
  end
  redis.call('SETEX', receipt, 2592000, '1')
  if data.avoid then redis.call('SETEX', pairKey(guest, target), 7776000, '1') end
  write(base .. 'report:' .. data.id, {
    id = data.id, room = data.room, reporter = guest, target = target,
    reason = data.reason, details = data.details, when = now
  }, 2592000)
  local reports = base .. 'reports'
  redis.call('ZADD', reports, now, data.id)
  redis.call('ZREMRANGEBYSCORE', reports, '-inf', now - 2592000000)
  return result({ok = true})
end

if action == 'leave' then
  if self and self.closed then return result({ok = true}) end
  if self then
    if data.avoid and self.peerGuest and redis.call('EXISTS', pairKey(guest, self.peerGuest)) == 0 then
      redis.call('SETEX', pairKey(guest, self.peerGuest), 45, '1')
    end
    redis.call('ZREM', base .. 'queue:' .. self.mode, session)
    if self.room then redis.call('DEL', inbox(self.room, session)) end
  end
  -- A retry must never resurrect a session that the browser already stopped.
  write(selfKey, {guest = guest, closed = true}, 60)
  return result({ok = true})
end

local function peerFor(value)
  if not value or not value.peer then return nil end
  local peer = read(base .. 'session:' .. value.peer)
  if peer and peer.room == value.room and peer.peer == session and not isBanned(peer.guest) then
    return peer
  end
end

if action == 'signal' or action == 'ice' then
  if isBanned(guest) then return failure(403, 'This browser is restricted from chatting.') end
  if not self or self.room ~= data.room or not peerFor(self) then
    return failure(409, 'The other person has left this chat.')
  end
  if action == 'ice' then
    local key = base .. 'ice:' .. guest
    if not rate(key, 18, 300) or not rate(base .. 'ice-ip:' .. data.ip, 120, 300) then
      return failure(429, 'Please wait before starting another call.')
    end
    return result({ok = true})
  end
  local key = inbox(self.room, self.peer)
  if redis.call('LLEN', key) >= 120 then return failure(429, 'Too many connection updates.') end
  redis.call('RPUSH', key, cjson.encode(data.signal))
  redis.call('EXPIRE', key, 120)
  return result({ok = true})
end

if action == 'join' and not self then
  if not rate(base .. 'join:' .. guest, 50, 300) or not rate(base .. 'join-ip:' .. data.ip, 200, 300) then
    return failure(429, 'Too many attempts. Please try again in a few minutes.')
  end
  self = {
    guest = guest, mode = data.mode, country = data.country, sameCountry = data.sameCountry,
    interests = data.interests, language = data.language
  }
end
if not self or self.closed then return result({state = 'ended'}) end

if self.room then
  local peer = peerFor(self)
  if not peer then
    write(selfKey, {guest = guest, closed = true}, 60)
    redis.call('DEL', inbox(self.room, session))
    return result({state = 'ended'})
  end
  write(selfKey, self, 45)
  redis.call('EXPIRE', base .. 'room:' .. self.room, 1800)
  local packets = redis.call('LRANGE', inbox(self.room, session), data.cursor or 0, -1)
  return result({
    state = 'matched', room = self.room, offerer = self.offerer,
    country = peer.country, signals = packets, shared = self.shared
  })
end

local function compatible(peer)
  if peer.guest == guest or isBanned(peer.guest) then return false end
  if (self.sameCountry or peer.sameCountry) and
     (self.country == '' or self.country ~= peer.country) then return false end
  if self.language ~= peer.language then return false end
  if #self.interests > 0 or #peer.interests > 0 then
    for _, mine in ipairs(self.interests) do
      for _, theirs in ipairs(peer.interests) do
        if mine == theirs then return true, mine end
      end
    end
    return false
  end
  return true, ''
end

local queue = base .. 'queue:' .. self.mode
redis.call('ZREMRANGEBYSCORE', queue, '-inf', now - 45000)
redis.call('ZADD', queue, now, session)
redis.call('EXPIRE', queue, 120)
local function match(start, finish)
  for _, id in ipairs(redis.call('ZRANGE', queue, start, finish)) do
    if id ~= session then
      local key = base .. 'session:' .. id
      local peer = read(key)
      if not peer or peer.closed or peer.room then
        redis.call('ZREM', queue, id)
      else
        local allowed, shared = compatible(peer)
        if allowed and redis.call('EXISTS', pairKey(guest, peer.guest)) == 0 then
          local roomId = data.candidateRoom
          self.room, self.peer, self.peerGuest, self.offerer, self.shared = roomId, id, peer.guest, true, shared
          peer.room, peer.peer, peer.peerGuest, peer.offerer, peer.shared = roomId, session, guest, false, shared
          write(selfKey, self, 45)
          write(key, peer, 45)
          write(base .. 'room:' .. roomId, {a = session, b = id, guestA = guest, guestB = peer.guest}, 1800)
          redis.call('ZREM', queue, id, session)
          return result({state = 'matched', room = roomId, offerer = true, country = peer.country, shared = shared})
        end
      end
    end
  end
end

local found = match(0, 63)
if found then return found end
local waiting = redis.call('ZCARD', queue)
if waiting > 64 then
  local start = 64 + math.floor(now / 1000) % (waiting - 64)
  found = match(start, start + 63)
  if found then return found end
end
write(selfKey, self, 45)
return result({state = 'waiting'})
`;
