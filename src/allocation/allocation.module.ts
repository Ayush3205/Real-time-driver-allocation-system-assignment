import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../redis/redis.module';
import { Driver } from '../drivers/entities/driver.entity';
import { RideOffer } from '../rides/entities/ride-offer.entity';
import { Ride } from '../rides/entities/ride.entity';
import { ALLOCATION_QUEUE } from './allocation.constants';
import { AllocationProcessor } from './allocation.processor';
import { AllocationService } from './allocation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ride, RideOffer, Driver]), RedisModule, BullModule.registerQueue({ name: ALLOCATION_QUEUE })],
  providers: [AllocationService, AllocationProcessor],
  exports: [AllocationService],
})
export class AllocationModule {}
