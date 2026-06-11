import { IsEnum } from 'class-validator';
import { DriverStatus } from '../driver-status.enum';

export class UpdateAvailabilityDto {
  @IsEnum(DriverStatus)
  status: DriverStatus;
}
