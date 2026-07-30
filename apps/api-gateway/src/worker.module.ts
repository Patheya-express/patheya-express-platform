import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';

import { envValidationSchema } from './config/env.validation';

import { PrismaModule } from './infrastructure/database/prisma.module';

import { LoggerModule } from './infrastructure/logger/logger.module';

import { RedisModule } from './infrastructure/redis/redis.module';

import { StorageModule } from './modules/storage/storage.module';

import { RealtimeModule } from './modules/realtime/realtime.module';

import { HealthModule } from './modules/health/health.module';

import { MetricsModule } from './modules/metrics/metrics.module';

import { QueuesModule } from './infrastructure/queues/queues.module';

import { EventsModule } from './modules/events/events.module';

/**
 * The standalone worker process's module graph — `docs/infrastructure/workers.md`'s own
 * documented gap ("there is only one main.ts entrypoint, and it always starts both the HTTP
 * server and every queue processor together") and the blueprint's Phase 4 roadmap item ("dedicated
 * worker-main.ts NestFactory.createApplicationContext() entrypoint... application-code work now
 * properly resourced as a named phase deliverable"), closed here.
 *
 * Deliberately excludes every business HTTP controller module (`AuthModule`, `OrdersModule`'s own
 * controllers, etc.) and `ThrottlerModule` — this process never serves customer/restaurant/admin
 * traffic, only the three BullMQ processors (`QueuesModule` already imports `DispatchModule`/
 * `NotificationsModule`/`OrdersModule` for their processors' own service dependencies) and a
 * minimal `/api/v1/health/*` surface for Kubernetes probes (`HealthModule`).
 *
 * `RealtimeModule` is still imported: `QueuesModule`'s processors (via `OrdersService`/
 * `NotificationsService`/`DispatchRepository`) emit Socket.IO events to notify connected clients
 * of state changes a background job caused (e.g. an order-acceptance timeout escalating) — those
 * services depend on `RealtimeService` regardless of which process runs them. The worker's own
 * gateway simply never receives real client connections (no Ingress routes to this process's
 * port), which is harmless; it still participates in the same Redis-adapter pub/sub as api-gateway
 * so an event it emits reaches whichever api-gateway pod holds the actual client connection.
 *
 * `EventsModule` is imported directly here too: it's `@Global()`, but that only broadcasts
 * `EventBusService` within the module graph it's actually part of. This process boots a wholly
 * separate Nest application context from `WorkerModule` (not `AppModule`), so without this import
 * `QueuesModule` -> `NotificationsModule`'s `OrderNotificationListener`/
 * `RestaurantOrderNotificationListener` (both inject `EventBusService`) fail DI resolution here
 * even though the same providers resolve fine in the api-gateway process.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),

    PrismaModule,
    LoggerModule,
    RedisModule,
    StorageModule,
    MetricsModule,
    RealtimeModule,
    HealthModule,
    EventsModule,
    QueuesModule,
  ],
})
export class WorkerModule {}
