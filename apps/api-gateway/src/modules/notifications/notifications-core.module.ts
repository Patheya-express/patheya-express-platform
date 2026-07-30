import { Module } from '@nestjs/common';

import { NotificationsService } from './services/notifications.service';

import { NotificationsRepository } from './repositories/notifications.repository';

import { OrderNotificationListener } from './listeners/order-notification.listener';
import { RestaurantOrderNotificationListener } from './listeners/restaurant-order-notification.listener';

/**
 * Controller-free core of the notifications feature. Includes the two EventBus listeners
 * (`OrderNotificationListener`/`RestaurantOrderNotificationListener`) alongside the service —
 * they subscribe to events published by Core-tier services that run in the Worker (e.g.
 * `OrdersService`/`DispatchService`), so they must keep running there, exactly as they do today.
 * Kept separate from `NotificationsModule` (which owns `NotificationsController`) so importing
 * this never pulls a controller into the Worker process.
 */
@Module({
  providers: [
    NotificationsService,
    NotificationsRepository,
    OrderNotificationListener,
    RestaurantOrderNotificationListener,
  ],

  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsCoreModule {}
