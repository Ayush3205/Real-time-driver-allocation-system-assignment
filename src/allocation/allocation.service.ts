import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource, In, Not, Repository } from 'typeorm';
import { DriverStatus } from '../drivers/driver-status.enum';
import { Driver } from '../drivers/entities/driver.entity';
import { RedisService } from '../redis/redis.service';
import { RideOffer } from '../rides/entities/ride-offer.entity';
import { Ride } from '../rides/entities/ride.entity';
import { OfferStatus, RideState } from '../rides/ride.enums';
import { ACCEPT_RIDE_SCRIPT, MARK_TIMEOUT_SCRIPT, RELEASE_LOCK_SCRIPT } from './accept-ride.script';
import { ALLOCATION_ATTEMPT_JOB, ALLOCATION_QUEUE } from './allocation.constants';
import { RedisKeys } from './redis-keys';

type AcceptanceCode =
  | 'ACCEPTED'
  | 'ALREADY_ASSIGNED'
  | 'DRIVER_BUSY'
  | 'INVALID_STATE'
  | 'NOT_ACTIVE_OFFER'
  | 'OFFER_EXPIRED'
  | 'RIDE_NOT_FOUND';

@Injectable()
export class AllocationService {
  constructor(
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
    @InjectRepository(RideOffer)
    private readonly offerRepository: Repository<RideOffer>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectQueue(ALLOCATION_QUEUE)
    private readonly queue: Queue,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async startAllocation(rideId: string) {
    const ride = await this.rideRepository.findOne({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException(`Ride ${rideId} was not found`);
    }

    if (ride.state !== RideState.REQUESTED) {
      throw new BadRequestException(`Ride ${rideId} cannot start allocation from ${ride.state}`);
    }

    const pipeline = this.redis.client.pipeline();
    pipeline.hset(RedisKeys.rideState(rideId), {
      rideId,
      state: RideState.SEARCHING,
      assignedDriverId: '',
      activeAttempt: '0',
      activeOfferExpiresAt: '0',
      pickupLat: String(ride.pickupLat),
      pickupLng: String(ride.pickupLng),
    });
    pipeline.expire(RedisKeys.rideState(rideId), this.rideStateTtlSeconds);
    pipeline.expire(RedisKeys.rideAcceptances(rideId), this.rideStateTtlSeconds);
    pipeline.expire(RedisKeys.rideNotifiedDrivers(rideId), this.rideStateTtlSeconds);
    await pipeline.exec();

    await this.rideRepository.update({ id: rideId, state: RideState.REQUESTED }, { state: RideState.SEARCHING });
    await this.enqueueAttempt(rideId, 1, 0);
  }

  async processAttempt(rideId: string, attempt: number) {
    const lockToken = randomUUID();
    const lockAcquired = await this.redis.client.set(RedisKeys.rideAllocationLock(rideId), lockToken, 'PX', 15000, 'NX');
    if (!lockAcquired) {
      return;
    }

    try {
      await this.expirePreviousAttempt(rideId, attempt - 1);

      const ride = await this.rideRepository.findOne({ where: { id: rideId } });
      if (!ride || ride.state === RideState.ASSIGNED || ride.state === RideState.TIMEOUT) {
        return;
      }

      const redisState = await this.redis.client.hget(RedisKeys.rideState(rideId), 'state');
      if (redisState === RideState.ASSIGNED || redisState === RideState.TIMEOUT) {
        return;
      }

      if (attempt > this.maxAttempts) {
        await this.markTimedOut(rideId);
        return;
      }

      const driverIds = await this.findNextDrivers(ride, attempt);
      if (driverIds.length === 0) {
        if (attempt >= this.maxAttempts) {
          await this.markTimedOut(rideId);
          return;
        }

        await this.enqueueAttempt(rideId, attempt + 1, Math.min(1000, this.offerTimeoutMs));
        return;
      }

      const now = Date.now();
      const expiresAt = new Date(now + this.offerTimeoutMs);

      const pipeline = this.redis.client.pipeline();
      pipeline.del(RedisKeys.rideActiveOffers(rideId));
      pipeline.sadd(RedisKeys.rideActiveOffers(rideId), ...driverIds);
      pipeline.pexpire(RedisKeys.rideActiveOffers(rideId), this.offerTimeoutMs + 5000);
      pipeline.sadd(RedisKeys.rideNotifiedDrivers(rideId), ...driverIds);
      pipeline.expire(RedisKeys.rideNotifiedDrivers(rideId), this.rideStateTtlSeconds);
      pipeline.hset(RedisKeys.rideState(rideId), {
        state: RideState.SEARCHING,
        activeAttempt: String(attempt),
        activeOfferExpiresAt: String(expiresAt.getTime()),
      });
      pipeline.expire(RedisKeys.rideState(rideId), this.rideStateTtlSeconds);
      await pipeline.exec();

      await this.rideRepository.update({ id: rideId }, { state: RideState.SEARCHING, attempt });
      await this.createOffers(rideId, driverIds, attempt, expiresAt);
      await this.enqueueAttempt(rideId, attempt + 1, this.offerTimeoutMs);
    } finally {
      await this.redis.client.eval(RELEASE_LOCK_SCRIPT, 1, RedisKeys.rideAllocationLock(rideId), lockToken);
    }
  }

  async acceptRide(rideId: string, driverId: string) {
    const now = Date.now();
    const result = (await this.redis.client.eval(
      ACCEPT_RIDE_SCRIPT,
      5,
      RedisKeys.rideState(rideId),
      RedisKeys.rideActiveOffers(rideId),
      RedisKeys.driverAssignment(driverId),
      RedisKeys.rideAcceptances(rideId),
      RedisKeys.availableDriversGeo(),
      rideId,
      driverId,
      String(now),
      String(this.driverAssignmentTtlSeconds),
    )) as [AcceptanceCode, string, string];

    const [code, assignedDriverId, state] = result;

    if (code === 'RIDE_NOT_FOUND') {
      throw new NotFoundException(`Ride ${rideId} was not found or its Redis state expired`);
    }

    if (code === 'ACCEPTED') {
      await this.persistAssignment(rideId, driverId, new Date(now));
      return {
        accepted: true,
        code,
        rideId,
        driverId,
        assignedDriverId: assignedDriverId || driverId,
        state: RideState.ASSIGNED,
      };
    }

    if (code === 'ALREADY_ASSIGNED') {
      await this.markOfferRejected(rideId, driverId);
      return {
        accepted: false,
        code,
        rideId,
        driverId,
        assignedDriverId,
        state: RideState.ASSIGNED,
      };
    }

    await this.markOfferRejected(rideId, driverId);

    return {
      accepted: false,
      code,
      rideId,
      driverId,
      assignedDriverId: assignedDriverId || null,
      state,
    };
  }

  private async findNextDrivers(ride: Ride, attempt: number) {
    const radiusKm = this.baseRadiusKm * Math.pow(this.radiusMultiplier, attempt - 1);
    const rawCandidates = (await this.redis.client.call(
      'GEOSEARCH',
      RedisKeys.availableDriversGeo(),
      'FROMLONLAT',
      String(ride.pickupLng),
      String(ride.pickupLat),
      'BYRADIUS',
      String(radiusKm),
      'km',
      'ASC',
      'COUNT',
      String(this.candidateLimit),
    )) as string[];

    if (!rawCandidates.length) {
      return [];
    }

    const notified = new Set(await this.redis.client.smembers(RedisKeys.rideNotifiedDrivers(ride.id)));
    const candidateIds = rawCandidates.filter((id) => !notified.has(id)).slice(0, this.candidateLimit);

    if (!candidateIds.length) {
      return [];
    }

    const availableDrivers = await this.driverRepository.find({
      where: { id: In(candidateIds), status: DriverStatus.AVAILABLE },
      select: { id: true },
    });
    const availableIds = new Set(availableDrivers.map((driver) => driver.id));
    const staleIds = candidateIds.filter((id) => !availableIds.has(id));

    if (staleIds.length) {
      await this.redis.client.zrem(RedisKeys.availableDriversGeo(), ...staleIds);
    }

    return candidateIds.filter((id) => availableIds.has(id)).slice(0, this.batchSize);
  }

  private async createOffers(rideId: string, driverIds: string[], attempt: number, expiresAt: Date) {
    const offers = driverIds.map((driverId) =>
      this.offerRepository.create({
        rideId,
        driverId,
        attempt,
        status: OfferStatus.OFFERED,
        expiresAt,
        acceptedAt: null,
      }),
    );

    await this.offerRepository.upsert(offers, {
      conflictPaths: ['rideId', 'driverId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  private async expirePreviousAttempt(rideId: string, attempt: number) {
    if (attempt <= 0) {
      return;
    }

    await this.offerRepository.update(
      { rideId, attempt, status: OfferStatus.OFFERED },
      { status: OfferStatus.EXPIRED },
    );
  }

  private async persistAssignment(rideId: string, driverId: string, acceptedAt: Date) {
    await this.dataSource.transaction(async (manager) => {
      const ride = await manager.findOne(Ride, {
        where: { id: rideId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!ride) {
        throw new NotFoundException(`Ride ${rideId} was not found`);
      }

      if (ride.state === RideState.ASSIGNED && ride.assignedDriverId !== driverId) {
        throw new BadRequestException(`Ride ${rideId} is already assigned to another driver`);
      }

      if (ride.state !== RideState.SEARCHING && ride.state !== RideState.ASSIGNED) {
        throw new BadRequestException(`Ride ${rideId} cannot be assigned from ${ride.state}`);
      }

      if (ride.state !== RideState.ASSIGNED) {
        ride.state = RideState.ASSIGNED;
        ride.assignedDriverId = driverId;
        ride.assignedAt = acceptedAt;
        await manager.save(Ride, ride);
      }

      await manager.update(Driver, { id: driverId }, { status: DriverStatus.BUSY, activeRideId: rideId });
      await manager.update(
        RideOffer,
        { rideId, driverId },
        { status: OfferStatus.ACCEPTED, acceptedAt },
      );
      await manager.update(
        RideOffer,
        { rideId, status: OfferStatus.OFFERED },
        { status: OfferStatus.REJECTED },
      );
    });

    const pipeline = this.redis.client.pipeline();
    pipeline.zrem(RedisKeys.availableDriversGeo(), driverId);
    pipeline.del(RedisKeys.rideActiveOffers(rideId));
    await pipeline.exec();
  }

  private async markOfferRejected(rideId: string, driverId: string) {
    await this.offerRepository.update(
      { rideId, driverId, status: OfferStatus.OFFERED },
      { status: OfferStatus.REJECTED },
    );
  }

  private async markTimedOut(rideId: string) {
    const now = new Date();
    const result = (await this.redis.client.eval(
      MARK_TIMEOUT_SCRIPT,
      2,
      RedisKeys.rideState(rideId),
      RedisKeys.rideActiveOffers(rideId),
      String(now.getTime()),
    )) as [string, string];

    if (result[0] !== RideState.TIMEOUT) {
      return;
    }

    await this.rideRepository.update(
      { id: rideId, state: Not(RideState.ASSIGNED) },
      { state: RideState.TIMEOUT, timedOutAt: now },
    );
    await this.offerRepository.update(
      { rideId, status: OfferStatus.OFFERED },
      { status: OfferStatus.EXPIRED },
    );
  }

  private enqueueAttempt(rideId: string, attempt: number, delayMs: number) {
    return this.queue.add(
      ALLOCATION_ATTEMPT_JOB,
      { rideId, attempt },
      {
        jobId: `ride:${rideId}:attempt:${attempt}`,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  private get batchSize() {
    return Number(this.config.get('ALLOCATION_BATCH_SIZE', 3));
  }

  private get offerTimeoutMs() {
    return Number(this.config.get('ALLOCATION_OFFER_TIMEOUT_MS', 8000));
  }

  private get maxAttempts() {
    return Number(this.config.get('ALLOCATION_MAX_ATTEMPTS', 3));
  }

  private get baseRadiusKm() {
    return Number(this.config.get('ALLOCATION_BASE_RADIUS_KM', 5));
  }

  private get radiusMultiplier() {
    return Number(this.config.get('ALLOCATION_RADIUS_MULTIPLIER', 2));
  }

  private get candidateLimit() {
    return Number(this.config.get('ALLOCATION_CANDIDATE_LIMIT', 50));
  }

  private get driverAssignmentTtlSeconds() {
    return Number(this.config.get('DRIVER_ASSIGNMENT_TTL_SECONDS', 7200));
  }

  private get rideStateTtlSeconds() {
    return Number(this.config.get('RIDE_STATE_TTL_SECONDS', 86400));
  }
}
