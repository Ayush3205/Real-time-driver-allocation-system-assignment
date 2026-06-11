import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AcceptRideDto } from './dto/accept-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { RidesService } from './rides.service';

@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post()
  requestRide(@Body() dto: RequestRideDto) {
    return this.ridesService.requestRide(dto);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ridesService.findOne(id);
  }

  @Get(':id/offers')
  findOffers(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ridesService.findOffers(id);
  }

  @Post(':id/accept')
  acceptRide(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AcceptRideDto) {
    return this.ridesService.acceptRide(id, dto);
  }
}
