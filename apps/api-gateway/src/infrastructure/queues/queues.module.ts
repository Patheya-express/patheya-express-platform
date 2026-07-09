import { Global, Module } from '@nestjs/common';

import { BullModule } from '@nestjs/bullmq';

import { QueueService } from './queue.service';

import { NotificationProcessor } from './processors/notification.processor';

import { AssignmentExpiryProcessor } from './processors/assignment-expiry.processor';
import { DispatchModule } from '../../modules/dispatch/dispatch.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';

@Global()
@Module({
  imports: [
    DispatchModule,
    NotificationsModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,

        port: Number(process.env.REDIS_PORT),
      },
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
    ),
  ],

  providers: [QueueService, NotificationProcessor, AssignmentExpiryProcessor],

  exports: [QueueService],
})
export class QueuesModule {}
