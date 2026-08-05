import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

import { RedisInfrastructureModule } from '../redis-infrastructure/redis-infrastructure.module';

/**
 * `RedisInfrastructureModule` is `@Global()` too, so this import isn't strictly required for
 * `RedisService`'s `RedisConnectionFactory` injection to resolve — added anyway for an explicit,
 * self-contained dependency graph rather than relying on global-registration order.
 */
@Global()
@Module({
  imports: [RedisInfrastructureModule],

  providers: [RedisService],

  exports: [RedisService],
})
export class RedisModule {}
