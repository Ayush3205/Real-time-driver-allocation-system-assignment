import { Driver } from '../../drivers/entities/driver.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RideOffer } from './ride-offer.entity';
import { RideState } from '../ride.enums';

@Entity('rides')
@Index(['state'])
export class Ride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rider_id', type: 'varchar', length: 120 })
  riderId: string;

  @Column({ name: 'pickup_lat', type: 'double precision' })
  pickupLat: number;

  @Column({ name: 'pickup_lng', type: 'double precision' })
  pickupLng: number;

  @Column({ name: 'dropoff_lat', type: 'double precision', nullable: true })
  dropoffLat: number | null;

  @Column({ name: 'dropoff_lng', type: 'double precision', nullable: true })
  dropoffLng: number | null;

  @Column({ type: 'enum', enum: RideState, default: RideState.REQUESTED })
  state: RideState;

  @Column({ name: 'assigned_driver_id', type: 'uuid', nullable: true })
  assignedDriverId: string | null;

  @ManyToOne(() => Driver, { nullable: true })
  @JoinColumn({ name: 'assigned_driver_id' })
  assignedDriver?: Driver | null;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'timed_out_at', type: 'timestamptz', nullable: true })
  timedOutAt: Date | null;

  @OneToMany(() => RideOffer, (offer) => offer.ride)
  offers: RideOffer[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
