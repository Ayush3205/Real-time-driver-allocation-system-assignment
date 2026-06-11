# Vybe Cabs Driver Allocation

NestJS service for allocating the nearest available driver to a ride request with PostgreSQL persistence and Redis-backed real-time coordination.

## Setup

Requirements:

- Node.js 20+
- Docker Desktop, or local PostgreSQL and Redis

Create `.env`:

```bash
cp .env.example .env
```

Start PostgreSQL and Redis:

```bash
docker compose up -d postgres redis
```

Install dependencies and run:

```bash
npm install
npm run start:dev
```

API base URL:

```text
http://localhost:3000
```

Full Docker run:

```bash
docker compose --profile app up --build
```

## Environment

Core variables live in `.env.example`.

Database:

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DB_SYNCHRONIZE`
- `DB_LOGGING`

Redis:

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_DB`

Allocation:

- `ALLOCATION_BATCH_SIZE`
- `ALLOCATION_OFFER_TIMEOUT_MS`
- `ALLOCATION_MAX_ATTEMPTS`
- `ALLOCATION_BASE_RADIUS_KM`
- `ALLOCATION_RADIUS_MULTIPLIER`
- `ALLOCATION_CANDIDATE_LIMIT`
- `DRIVER_ASSIGNMENT_TTL_SECONDS`
- `RIDE_STATE_TTL_SECONDS`

Keep `DB_SYNCHRONIZE=true` for local review. Use migrations for a production-style deployment.

## API

Create a driver:

```bash
curl -X POST http://localhost:3000/drivers \
  -H "content-type: application/json" \
  -d '{"name":"Driver 1","lat":28.6139,"lng":77.2090,"status":"AVAILABLE"}'
```

Update driver location:

```bash
curl -X PATCH http://localhost:3000/drivers/<driverId>/location \
  -H "content-type: application/json" \
  -d '{"lat":28.6145,"lng":77.2101,"status":"AVAILABLE"}'
```

Preview nearest drivers:

```bash
curl "http://localhost:3000/drivers/nearby?lat=28.6139&lng=77.2090&radiusKm=5&limit=5"
```

Request a ride:

```bash
curl -X POST http://localhost:3000/rides \
  -H "content-type: application/json" \
  -d '{"riderId":"rider-1","pickupLat":28.6139,"pickupLng":77.2090}'
```

Check offers:

```bash
curl http://localhost:3000/rides/<rideId>/offers
```

Accept an offer:

```bash
curl -X POST http://localhost:3000/rides/<rideId>/accept \
  -H "content-type: application/json" \
  -d '{"driverId":"<driverId>"}'
```

Run the concurrency simulation:

```bash
npm run simulate:concurrency
```

Custom target:

```bash
node scripts/simulate-concurrency.js http://localhost:3000 12
```

## Architecture

PostgreSQL stores durable records:

- `drivers`
- `rides`
- `ride_offers`

Redis stores live allocation data:

- `drivers:geo:available`
- `ride:<rideId>:state`
- `ride:<rideId>:active-offers`
- `ride:<rideId>:notified-drivers`
- `ride:<rideId>:acceptances`
- `driver:<driverId>:assignment`

Available drivers are indexed with `GEOADD`. Allocation and nearby preview use `GEOSEARCH ... ASC`, so candidates are processed nearest first. Stale Redis candidates are dropped when PostgreSQL no longer shows the driver as `AVAILABLE`.

Ride lifecycle:

```text
REQUESTED -> SEARCHING -> ASSIGNED
REQUESTED -> SEARCHING -> TIMEOUT
```

BullMQ schedules each allocation attempt. An attempt opens a batch of offers, waits for `ALLOCATION_OFFER_TIMEOUT_MS`, then moves to the next batch. No candidates after the final attempt marks the ride as `TIMEOUT`.

## Concurrency Approach

Driver acceptance runs through `ACCEPT_RIDE_SCRIPT` in `src/allocation/accept-ride.script.ts`.

Acceptance rejects stale accepts, expired offers, duplicates, non-active offers, and already-assigned rides before writing the winner. Winning writes `state=ASSIGNED`, stores `assignedDriverId`, caches the driver's result, and removes that driver from the available GEO set in one Redis script execution.

`SET driver:<driverId>:assignment NX EX ...` blocks the same driver from being assigned to another ride at the same time. A PostgreSQL transaction with a pessimistic ride-row lock then persists the Redis winner.

## Assumptions

- Creating a `ride_offers` row represents notifying the driver.
- Push delivery is outside this assignment; WebSocket or mobile push can be added behind the offer creation step.
- Redis is the fast coordination layer. PostgreSQL is the durable read model.
- Local setup uses synchronized TypeORM entities for speed.
- Docker Compose is provided for Redis and PostgreSQL.
