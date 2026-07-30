import { Module } from '@nestjs/common';

import { NotificationsController } from './controllers/notifications.controller';

import { NotificationsService } from './services/notifications.service';

import { NotificationsRepository } from './repositories/notifications.repository';

import { OrderNotificationListener } from './listeners/order-notification.listener';
import { RestaurantOrderNotificationListener } from './listeners/restaurant-order-notification.listener';

@Module({
  controllers: [NotificationsController],

  providers: [
    NotificationsService,

    NotificationsRepository,

    OrderNotificationListener,

    RestaurantOrderNotificationListener,
  ],

  exports: [NotificationsService],
})
export class NotificationsModule {}
