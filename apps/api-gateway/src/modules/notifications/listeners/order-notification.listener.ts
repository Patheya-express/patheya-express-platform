import { Injectable, OnModuleInit } from '@nestjs/common';

import { NotificationType } from '@prisma/client';

import { EventBusService } from '../../../core/events/event-bus.service';

import { NotificationsService } from '../services/notifications.service';

@Injectable()
export class OrderNotificationListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,

    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      'order.placed',

      async (event) => {
        await this.notificationsService.createNotification(
          event.customerId,

          NotificationType.ORDER_PLACED,

          'Order Placed',

          `Order ${event.orderId} has been placed.`,

          { referenceType: 'ORDER', referenceId: event.orderId },
        );
      },
    );

    this.eventBus.subscribe(
      'order.status.changed',

      async (event) => {
        const messages = {
          CONFIRMED: 'Your order has been confirmed.',

          PREPARING: 'Your food is being prepared.',

          READY_FOR_PICKUP: 'Your order is ready for pickup.',

          OUT_FOR_DELIVERY: 'Your order is on the way.',

          DELIVERED: 'Your order has been delivered.',

          CANCELLED: 'Your order has been cancelled.',
        };

        const message = messages[event.status];

        if (!message) {
          return;
        }

        await this.notificationsService.createNotification(
          event.customerId,

          NotificationType.ORDER_STATUS_CHANGED,

          'Order Update',

          message,

          { referenceType: 'ORDER', referenceId: event.orderId },
        );
      },
    );

    this.eventBus.subscribe(
      'delivery.partner.assigned',

      async (event) => {
        await this.notificationsService.createNotification(
          event.customerId,

          NotificationType.DELIVERY_PARTNER_ASSIGNED,

          'Delivery Partner Assigned',

          'A delivery partner has been assigned to your order.',

          { referenceType: 'ORDER', referenceId: event.orderId },
        );
      },
    );

    // Sprint 1.8 — no customer-facing notification existed for a refund before this (only a
    // WalletTransaction ledger row for the wallet leg, and a restaurant-side notification).
    // Fires once per completed refund — OrdersService.refundOrder publishes this event only
    // after winning its own order-level exactly-once claim.
    this.eventBus.subscribe(
      'order.refund.completed',

      async (event) => {
        await this.notificationsService.createNotification(
          event.customerId,

          NotificationType.REFUND_ISSUED,

          'Refund issued',

          `A refund of ${event.amount} was issued for your order.`,

          { referenceType: 'ORDER', referenceId: event.orderId },
        );
      },
    );
  }
}
