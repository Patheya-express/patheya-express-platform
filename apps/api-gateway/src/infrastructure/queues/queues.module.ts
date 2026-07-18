import { Global, Module } from '@nestjs/common';

import { BullModule } from '@nestjs/bullmq';

import { QueueService } from './queue.service';

import { NotificationProcessor } from './processors/notification.processor';

import { AssignmentExpiryProcessor } from './processors/assignment-expiry.processor';
import { OrderAcceptanceTimeoutProcessor } from './processors/order-acceptance-timeout.processor';
import { DispatchModule } from '../../modules/dispatch/dispatch.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { OrdersModule } from '../../modules/orders/orders.module';
import { getRedisConnectionOptions } from '../redis/redis-connection.config';

@Global()
@Module({
  imports: [
    DispatchModule,
    NotificationsModule,
    OrdersModule,
    BullModule.forRoot({
      connection: getRedisConnectionOptions(),
    }),

    BullModule.registerQueue(
      { name: 'notifications' },
      {
        name: 'dispatch',
      },
      {
        name: 'payments',
      },
      {
        name: 'search',
      },
      {
        name: 'tickets',
      },
      {
        name: 'orders',
      },
    ),
  ],

  providers: [
    QueueService,
    NotificationProcessor,
    AssignmentExpiryProcessor,
    OrderAcceptanceTimeoutProcessor,
  ],

  exports: [QueueService],
})
export class QueuesModule {}
