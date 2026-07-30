import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';

import { envValidationSchema } from './config/env.validation';

import { PrismaModule } from './infrastructure/database/prisma.module';

import { HealthModule } from './modules/health/health.module';

import { LoggerModule } from './infrastructure/logger/logger.module';

import { AuthModule } from './modules/auth/auth.module';

import { UsersModule } from './modules/users/users.module';

import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';

import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EventsModule } from './modules/events/events.module';
import { StorageModule } from './modules/storage/storage.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { RedisInfrastructureModule } from './infrastructure/redis-infrastructure/redis-infrastructure.module';
import { SystemModule } from './modules/system/system.module';
import { QueueInfrastructureModule } from './infrastructure/queues/queue-infrastructure.module';
import { QueueProducerModule } from './infrastructure/queues/queue-producer.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';

import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { PresenceModule } from './modules/presence/presence.module';
import { AdminModule } from './modules/admin/admin.module';
import { CustomerModule } from './modules/customer/customer.module';
import { CartModule } from './modules/cart/cart.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { OffersModule } from './modules/offers/offers.module';
import { SearchModule } from './modules/search/search.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { ReportsModule } from './modules/reports/reports.module';
import { APP_GUARD } from '@nestjs/core';

import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,

      load: [configuration],

      validationSchema: envValidationSchema,
    }),

    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),

    PrismaModule,

    HealthModule,

    AuthModule,

    UsersModule,

    RestaurantsModule,

    OnboardingModule,

    MenuModule,

    OrdersModule,

    DeliveryModule,

    AuditModule,

    NotificationsModule,

    EventsModule,

    StorageModule,

    MetricsModule,

    RealtimeModule,

    RedisModule,

    RedisInfrastructureModule,

    SystemModule,

    QueueInfrastructureModule,

    QueueProducerModule,

    PaymentsModule,

    LoggerModule,

    DispatchModule,

    PresenceModule,

    AdminModule,

    CustomerModule,

    CartModule,

    AddressesModule,

    TrackingModule,

    FavoritesModule,

    OffersModule,

    SearchModule,

    WalletModule,

    TicketsModule,

    CouponsModule,

    ReportsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
