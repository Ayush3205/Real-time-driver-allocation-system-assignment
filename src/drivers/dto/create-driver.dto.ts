import { Type } from 'class-transformer';
import { IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';
import { DriverStatus } from '../driver-status.enum';

export class CreateDriverDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}
