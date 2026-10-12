import { Module } from '@nestjs/common';

import { NotificationsService } from './services/notifications.service';

import { NotificationsRepository } from './repositories/notifications.repository';

import { OrderNotificationListener } from './listeners/order-notification.listener';
import { RestaurantOrderNotificationListener } from './listeners/restaurant-order-notification.listener';
import { DeliveryAssignmentPushListener } from './listeners/delivery-assignment-push.listener';
import {
  PUSH_DISPATCHER,
  UnconfiguredPushProvider,
} from './push/push-provider';
import {
  FcmPushProvider,
  fcmCredentialsFromEnv,
} from './push/fcm-push-provider';
import {
  ApnsPushProvider,
  apnsCredentialsFromEnv,
} from './push/apns-push-provider';
import { PlatformPushDispatcher } from './push/platform-push-dispatcher';

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
    DeliveryAssignmentPushListener,
    // Android devices go to FCM, iOS devices to APNs (see PlatformPushDispatcher). Each platform
    // is enabled by its own credentials (FCM_* / APNS_*); a platform without them is never
    // attempted, and an attempt with no provider at all is recorded FAILED — never SENT.
    {
      provide: PUSH_DISPATCHER,
      useFactory: () => {
        const fcm = fcmCredentialsFromEnv();
        const apns = apnsCredentialsFromEnv();
        return new PlatformPushDispatcher({
          android: fcm
            ? new FcmPushProvider(fcm)
            : new UnconfiguredPushProvider(),
          ios: apns
            ? new ApnsPushProvider(apns)
            : new UnconfiguredPushProvider(),
        });
      },
    },
  ],

  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsCoreModule {}
