export const ACCEPT_RIDE_SCRIPT = `
local rideKey = KEYS[1]
local activeOffersKey = KEYS[2]
local driverAssignmentKey = KEYS[3]
local acceptancesKey = KEYS[4]
local availableDriversGeoKey = KEYS[5]

local rideId = ARGV[1]
local driverId = ARGV[2]
local nowMs = tonumber(ARGV[3])
local assignmentTtlSec = tonumber(ARGV[4])

local existingAcceptance = redis.call('HGET', acceptancesKey, driverId)
if existingAcceptance then
  local assignedDriverId = redis.call('HGET', rideKey, 'assignedDriverId') or ''
  local state = redis.call('HGET', rideKey, 'state') or ''
  return { existingAcceptance, assignedDriverId, state }
end

local state = redis.call('HGET', rideKey, 'state')
if not state then
  redis.call('HSET', acceptancesKey, driverId, 'RIDE_NOT_FOUND')
  return { 'RIDE_NOT_FOUND', '', '' }
end

local assignedDriverId = redis.call('HGET', rideKey, 'assignedDriverId') or ''
if state == 'ASSIGNED' then
  if assignedDriverId == driverId then
    redis.call('HSET', acceptancesKey, driverId, 'ACCEPTED')
    return { 'ACCEPTED', assignedDriverId, state }
  end

  redis.call('HSET', acceptancesKey, driverId, 'ALREADY_ASSIGNED')
  return { 'ALREADY_ASSIGNED', assignedDriverId, state }
end

if state ~= 'SEARCHING' then
  redis.call('HSET', acceptancesKey, driverId, 'INVALID_STATE')
  return { 'INVALID_STATE', assignedDriverId, state }
end

if redis.call('SISMEMBER', activeOffersKey, driverId) == 0 then
  redis.call('HSET', acceptancesKey, driverId, 'NOT_ACTIVE_OFFER')
  return { 'NOT_ACTIVE_OFFER', assignedDriverId, state }
end

local activeOfferExpiresAt = tonumber(redis.call('HGET', rideKey, 'activeOfferExpiresAt') or '0')
if activeOfferExpiresAt <= 0 or nowMs > activeOfferExpiresAt then
  redis.call('HSET', acceptancesKey, driverId, 'OFFER_EXPIRED')
  return { 'OFFER_EXPIRED', assignedDriverId, state }
end

local currentDriverAssignment = redis.call('GET', driverAssignmentKey)
if currentDriverAssignment and currentDriverAssignment ~= rideId then
  redis.call('HSET', acceptancesKey, driverId, 'DRIVER_BUSY')
  return { 'DRIVER_BUSY', assignedDriverId, state }
end

if not currentDriverAssignment then
  local locked = redis.call('SET', driverAssignmentKey, rideId, 'NX', 'EX', assignmentTtlSec)
  if not locked then
    redis.call('HSET', acceptancesKey, driverId, 'DRIVER_BUSY')
    return { 'DRIVER_BUSY', assignedDriverId, state }
  end
end

redis.call('HSET', rideKey,
  'state', 'ASSIGNED',
  'assignedDriverId', driverId,
  'assignedAt', tostring(nowMs)
)
redis.call('HSET', acceptancesKey, driverId, 'ACCEPTED')
redis.call('ZREM', availableDriversGeoKey, driverId)

return { 'ACCEPTED', driverId, 'ASSIGNED' }
`;

export const MARK_TIMEOUT_SCRIPT = `
local rideKey = KEYS[1]
local activeOffersKey = KEYS[2]
local nowMs = ARGV[1]

local state = redis.call('HGET', rideKey, 'state')
if not state then
  return { 'RIDE_NOT_FOUND', '' }
end

if state == 'ASSIGNED' then
  return { 'ASSIGNED', redis.call('HGET', rideKey, 'assignedDriverId') or '' }
end

redis.call('HSET', rideKey, 'state', 'TIMEOUT', 'timedOutAt', nowMs)
redis.call('DEL', activeOffersKey)
return { 'TIMEOUT', '' }
`;

export const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
