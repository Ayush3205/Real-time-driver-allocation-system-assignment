import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RedisKeys } from '../allocation/redis-keys';
import { RedisService } from '../redis/redis.service';
import { RideOffer } from '../rides/entities/ride-offer.entity';
import { OfferStatus } from '../rides/ride.enums';
import { DriverStatus } from './driver-status.enum';
import { CreateDriverDto } from './dto/create-driver.dto';
import { FindNearbyDriversDto } from './dto/find-nearby-drivers.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { Driver } from './entities/driver.entity';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(RideOffer)
    private readonly offerRepository: Repository<RideOffer>,
    private readonly redis: RedisService,
  ) {}

  async create(dto: CreateDriverDto) {
    const driver = this.driverRepository.create({
      name: dto.name,
      currentLat: dto.lat ?? null,
      currentLng: dto.lng ?? null,
      status: dto.status ?? DriverStatus.AVAILABLE,
      activeRideId: null,
    });

    const saved = await this.driverRepository.save(driver);
    await this.syncDriverInRedis(saved);
    return saved;
  }

  async findOne(id: string) {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) {
      throw new NotFoundException(`Driver ${id} was not found`);
    }

    return driver;
  }

  async findNearby(dto: FindNearbyDriversDto) {
    const rawResults = (await this.redis.client.call(
      'GEOSEARCH',
      RedisKeys.availableDriversGeo(),
      'FROMLONLAT',
      String(dto.lng),
      String(dto.lat),
      'BYRADIUS',
      String(dto.radiusKm ?? 5),
      'km',
      'WITHDIST',
      'ASC',
      'COUNT',
      String(dto.limit ?? 10),
    )) as [string, string][];

    if (!rawResults.length) {
      return [];
    }

    const distancesByDriverId = new Map(rawResults.map(([driverId, distance]) => [driverId, Number(distance)]));
    const driverIds = rawResults.map(([driverId]) => driverId);
    const drivers = await this.driverRepository.find({
      where: { id: In(driverIds), status: DriverStatus.AVAILABLE },
    });
    const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
    const staleIds = driverIds.filter((driverId) => !driversById.has(driverId));

    if (staleIds.length) {
      await this.redis.client.zrem(RedisKeys.availableDriversGeo(), ...staleIds);
    }

    return rawResults.filter(([driverId]) => driversById.has(driverId)).map(([driverId]) => {
      const driver = driversById.get(driverId)!;
      return {
        ...driver,
        distanceKm: distancesByDriverId.get(driverId),
      };
    });
  }

  async findOffers(id: string) {
    await this.findOne(id);
    return this.offerRepository.find({
      where: { driverId: id, status: OfferStatus.OFFERED },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async updateLocation(id: string, dto: UpdateLocationDto) {
    const driver = await this.findOne(id);
    driver.currentLat = dto.lat;
    driver.currentLng = dto.lng;
    driver.status = dto.status ?? driver.status;

    const saved = await this.driverRepository.save(driver);
    await this.syncDriverInRedis(saved);
    return saved;
  }

  async updateAvailability(id: string, dto: UpdateAvailabilityDto) {
    const driver = await this.findOne(id);
    driver.status = dto.status;

    if (dto.status === DriverStatus.AVAILABLE) {
      driver.activeRideId = null;
      await this.redis.client.del(RedisKeys.driverAssignment(id));
    }

    const saved = await this.driverRepository.save(driver);
    await this.syncDriverInRedis(saved);
    return saved;
  }

  private async syncDriverInRedis(driver: Driver) {
    const pipeline = this.redis.client.pipeline();

    pipeline.hset(RedisKeys.driverState(driver.id), {
      id: driver.id,
      status: driver.status,
      lat: driver.currentLat === null ? '' : String(driver.currentLat),
      lng: driver.currentLng === null ? '' : String(driver.currentLng),
      activeRideId: driver.activeRideId ?? '',
    });

    if (driver.status === DriverStatus.AVAILABLE && driver.currentLat !== null && driver.currentLng !== null) {
      pipeline.call('GEOADD', RedisKeys.availableDriversGeo(), String(driver.currentLng), String(driver.currentLat), driver.id);
    } else {
      pipeline.zrem(RedisKeys.availableDriversGeo(), driver.id);
    }

    await pipeline.exec();
  }
}
