import { Global, Module } from '@nestjs/common';

import { RedisConfigurationService } from './redis-configuration.service';
import { RedisConnectionRegistry } from './redis-connection-registry.service';
import { RedisMetricsService } from './redis-metrics.service';
import { RedisLifecycleService } from './redis-lifecycle.service';
import { RedisConnectionFactory } from './redis-connection-factory.service';
import { RedisHealthService } from './redis-health.service';

/**
 * Foundation-only Redis infrastructure layer (Infrastructure Sprint A). Provides a
 * factory/registry/lifecycle/health/metrics/configuration surface that future sprints can
 * incrementally migrate `RedisService`, BullMQ (`QueueInfrastructureModule`), Socket.IO's Redis
 * adapter (`RealtimeGateway`), and `MetricsService`'s per-queue `QueueEvents` onto.
 *
 * This module creates zero Redis connections itself and is not injected by any existing
 * consumer — `RedisService`, `QueueInfrastructureModule`, `RealtimeGateway`, and `MetricsService`
 * are all untouched by this sprint and continue exactly as before. `@Global()` (matching the
 * existing `RedisModule`/`EventsModule`/`QueueProducerModule` convention) so every one of these
 * services is available for injection anywhere once a future sprint decides to use them, without
 * needing to add an import wherever that migration happens.
 */
@Global()
@Module({
  providers: [
    RedisConfigurationService,
    RedisConnectionRegistry,
    RedisMetricsService,
    RedisLifecycleService,
    RedisConnectionFactory,
    RedisHealthService,
  ],

  exports: [
    RedisConfigurationService,
    RedisConnectionRegistry,
    RedisMetricsService,
    RedisLifecycleService,
    RedisConnectionFactory,
    RedisHealthService,
  ],
})
export class RedisInfrastructureModule {}
