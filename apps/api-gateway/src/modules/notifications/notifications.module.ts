import { Module } from '@nestjs/common';

import { NotificationsController } from './controllers/notifications.controller';

import { NotificationsCoreModule } from './notifications-core.module';

/**
 * HTTP-facing half of the notifications feature — controller only. Business logic
 * (`NotificationsService`/`NotificationsRepository`) and the EventBus listeners live in
 * `NotificationsCoreModule`. Re-exports it so existing consumers of `NotificationsModule` keep
 * working unchanged; anything reachable from the Worker process now imports
 * `NotificationsCoreModule` directly.
 */
@Module({
  imports: [NotificationsCoreModule],

  controllers: [NotificationsController],

  exports: [NotificationsCoreModule],
})
export class NotificationsModule {}
