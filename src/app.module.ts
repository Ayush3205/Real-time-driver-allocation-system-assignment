import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllocationModule } from './allocation/allocation.module';
import { DriversModule } from './drivers/drivers.module';
import { HealthController } from './health.controller';
import { RidesModule } from './rides/rides.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('POSTGRES_HOST', 'localhost'),
        port: Number(config.get('POSTGRES_PORT', 5432)),
        username: config.get<string>('POSTGRES_USER', 'vybe'),
        password: config.get<string>('POSTGRES_PASSWORD', 'vybe'),
        database: config.get<string>('POSTGRES_DB', 'vybe_driver_allocation'),
        autoLoadEntities: true,
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        logging: config.get<string>('DB_LOGGING', 'false') === 'true',
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get('REDIS_PORT', 6379)),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: Number(config.get('REDIS_DB', 0)),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    AllocationModule,
    DriversModule,
    RidesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
