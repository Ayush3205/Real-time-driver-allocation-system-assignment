import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DriverStatus } from '../driver-status.enum';

@Entity('drivers')
@Index(['status'])
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'enum', enum: DriverStatus, default: DriverStatus.AVAILABLE })
  status: DriverStatus;

  @Column({ name: 'current_lat', type: 'double precision', nullable: true })
  currentLat: number | null;

  @Column({ name: 'current_lng', type: 'double precision', nullable: true })
  currentLng: number | null;

  @Column({ name: 'active_ride_id', type: 'uuid', nullable: true })
  activeRideId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
