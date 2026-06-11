import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateDriverDto } from './dto/create-driver.dto';
import { FindNearbyDriversDto } from './dto/find-nearby-drivers.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { DriversService } from './drivers.service';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  create(@Body() dto: CreateDriverDto) {
    return this.driversService.create(dto);
  }

  @Get('nearby')
  findNearby(@Query() dto: FindNearbyDriversDto) {
    return this.driversService.findNearby(dto);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.driversService.findOne(id);
  }

  @Get(':id/offers')
  findOffers(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.driversService.findOffers(id);
  }

  @Patch(':id/location')
  updateLocation(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateLocationDto) {
    return this.driversService.updateLocation(id, dto);
  }

  @Patch(':id/availability')
  updateAvailability(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateAvailabilityDto) {
    return this.driversService.updateAvailability(id, dto);
  }
}
