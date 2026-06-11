import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    const options: RedisOptions = {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(config.get('REDIS_PORT', 6379)),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(config.get('REDIS_DB', 0)),
      maxRetriesPerRequest: null,
    };

    this.client = new Redis(options);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
