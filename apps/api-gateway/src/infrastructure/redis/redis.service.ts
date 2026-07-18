import { Injectable, OnModuleDestroy } from '@nestjs/common';

import Redis from 'ioredis';

import { getRedisConnectionOptions } from './redis-connection.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(getRedisConnectionOptions());
  }

  getClient() {
    return this.redis;
  }

  async set(
    key: string,

    value: string,

    ttl?: number,
  ) {
    if (ttl) {
      await this.redis.set(key, value, 'EX', ttl);

      return;
    }

    await this.redis.set(key, value);
  }

  async get(key: string) {
    return this.redis.get(key);
  }

  async del(key: string) {
    return this.redis.del(key);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
