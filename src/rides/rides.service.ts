import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllocationService } from '../allocation/allocation.service';
import { AcceptRideDto } from './dto/accept-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { RideOffer } from './entities/ride-offer.entity';
import { Ride } from './entities/ride.entity';
import { RideState } from './ride.enums';

@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
    @InjectRepository(RideOffer)
    private readonly offerRepository: Repository<RideOffer>,
    private readonly allocationService: AllocationService,
  ) {}

  async requestRide(dto: RequestRideDto) {
    const ride = await this.rideRepository.save(
      this.rideRepository.create({
        riderId: dto.riderId,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffLat: dto.dropoffLat ?? null,
        dropoffLng: dto.dropoffLng ?? null,
        assignedDriverId: null,
        assignedAt: null,
        timedOutAt: null,
        state: RideState.REQUESTED,
        attempt: 0,
      }),
    );

    await this.allocationService.startAllocation(ride.id);
    return this.findOne(ride.id);
  }

  async findOne(id: string) {
    const ride = await this.rideRepository.findOne({
      where: { id },
      relations: { assignedDriver: true, offers: true },
      order: { offers: { createdAt: 'DESC' } },
    });

    if (!ride) {
      throw new NotFoundException(`Ride ${id} was not found`);
    }

    return ride;
  }

  async findOffers(id: string) {
    await this.ensureRideExists(id);
    return this.offerRepository.find({
      where: { rideId: id },
      order: { attempt: 'ASC', createdAt: 'ASC' },
    });
  }

  acceptRide(id: string, dto: AcceptRideDto) {
    return this.allocationService.acceptRide(id, dto.driverId);
  }

  private async ensureRideExists(id: string) {
    const exists = await this.rideRepository.exist({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Ride ${id} was not found`);
    }
  }
}
