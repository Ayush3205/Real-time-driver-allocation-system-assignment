import { IsUUID } from 'class-validator';

export class AcceptRideDto {
  @IsUUID()
  driverId: string;
}
