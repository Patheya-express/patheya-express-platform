import { Injectable } from '@nestjs/common';

import { RedisOptions } from 'ioredis';

import { getRedisConnectionOptions } from '../redis/redis-connection.config';

import { RedisConnectionOptionsBuilder } from './redis-connection-options.builder';

/**
 * Single place future consumers read Redis configuration through, instead of importing
 * `getRedisConnectionOptions()` directly. `getDefaultOptions()` is that same function today —
 * identical values, so nothing about `RedisService`/BullMQ/`RealtimeGateway`'s actual connection
 * behavior changes by this service existing. It just gives config changes one home to land in
 * once future sprints migrate onto it.
 */
@Injectable()
export class RedisConfigurationService {
  getDefaultOptions(): RedisOptions {
    return getRedisConnectionOptions();
  }

  builder(): RedisConnectionOptionsBuilder {
    return RedisConnectionOptionsBuilder.default();
  }

  isTlsEnabled(): boolean {
    return process.env.REDIS_TLS === 'true';
  }

  getHost(): string | undefined {
    return process.env.REDIS_HOST;
  }

  getPort(): number {
    return Number(process.env.REDIS_PORT);
  }
}
