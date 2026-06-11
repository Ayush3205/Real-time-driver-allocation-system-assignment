import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllocationModule } from '../allocation/allocation.module';
import { Driver } from '../drivers/entities/driver.entity';
import { RideOffer } from './entities/ride-offer.entity';
import { Ride } from './entities/ride.entity';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ride, RideOffer, Driver]), AllocationModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
