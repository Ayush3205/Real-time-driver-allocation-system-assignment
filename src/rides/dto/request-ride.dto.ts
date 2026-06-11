import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestRideDto {
  @IsString()
  @MaxLength(120)
  riderId: string;

  @Type(() => Number)
  @IsLatitude()
  pickupLat: number;

  @Type(() => Number)
  @IsLongitude()
  pickupLng: number;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  dropoffLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  dropoffLng?: number;
}
