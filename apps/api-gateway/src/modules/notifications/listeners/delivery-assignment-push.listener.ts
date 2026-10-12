import { Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { EventBusService } from '../../../core/events/event-bus.service';
import { NotificationsService } from '../services/notifications.service';
import type { DeliveryAssignmentOfferedEvent } from '../../dispatch/events/delivery-assignment-offered.event';

/**
 * Background/closed-app half of new-assignment alerts. The foreground half is the existing
 * `delivery.assignment` Socket.IO event, which only reaches an open app. This queues one PUSH
 * notification per assignment offer (de-duplicated by assignment id) through the notifications
 * queue; NotificationProcessor sends it via the configured PushProvider.
 *
 * Payload carries ids and a generic message only — no customer name, phone or address. A tap
 * opens the app at /assignments, which (after authentication) re-fetches the assignment and only
 * offers Accept/Reject if the backend still reports it PENDING for this partner.
 */
@Injectable()
export class DeliveryAssignmentPushListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      'delivery.assignment.offered',
      async (event: DeliveryAssignmentOfferedEvent) => {
        await this.notificationsService.queuePushNotification({
          userId: event.partnerUserId,
          type: NotificationType.DELIVERY_ASSIGNMENT_OFFERED,
          dedupeKey: `delivery-assignment-offered:${event.assignmentId}`,
          message: {
            // Created by the delivery app at startup with high importance (heads-up banner).
            androidChannelId: 'delivery_assignments',
            title: 'New delivery assigned',
            body: 'You have a new delivery offer. Open the app to review it before it expires.',
            data: {
              type: 'delivery.assignment',
              assignmentId: event.assignmentId,
              orderId: event.orderId,
            },
          },
        });
      },
    );
  }
}
