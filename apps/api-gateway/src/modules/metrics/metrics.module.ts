import { Global, Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';

import { MetricsService } from './metrics.service';

import { MetricsEventListener } from './metrics-event.listener';

import { RedisInfrastructureModule } from '../../infrastructure/redis-infrastructure/redis-infrastructure.module';

/**
 * `RedisInfrastructureModule` is `@Global()` too, so this import isn't strictly required for
 * `MetricsService`'s `RedisConnectionFactory`/`RedisConfigurationService` injection to resolve —
 * added anyway for an explicit, self-contained dependency graph (same convention as
 * `RedisModule`'s own import of it after the `RedisService` migration).
 *
 * `MetricsEventListener` (Production Readiness Stage B) needs `EventBusService`/`PrismaService`,
 * both `@Global()`, so no further imports are needed for it either.
 */
@Global()
@Module({
  imports: [RedisInfrastructureModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsEventListener],
  exports: [MetricsService],
})
export class MetricsModule {}
