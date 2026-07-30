import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { NotificationType } from '@prisma/client';

import { EventBusService } from '../../../core/events/event-bus.service';

import { NotificationsService } from '../services/notifications.service';
import { RealtimeService } from '../../realtime/services/realtime.service';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  getActiveRestaurantRecipientIds,
  getRestaurantNotificationPreferences,
  RestaurantNotificationPreferences,
} from '../../../shared/restaurant/restaurant-notification.util';

/**
 * Restaurant-facing counterpart to OrderNotificationListener — that listener notifies the
 * customer about their own order; this one notifies the restaurant's owner/active staff about
 * order events that concern them. Reuses the same EventBusService/NotificationsService/
 * RealtimeService wiring, not a parallel mechanism.
 */
@Injectable()
export class RestaurantOrderNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(
    RestaurantOrderNotificationListener.name,
  );

  constructor(
    private readonly eventBus: EventBusService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe('order.placed', async (event) => {
      await this.notifyRestaurant({
        restaurantId: event.restaurantId,
        orderId: event.orderId,
        preferenceKey: 'notifyOnNewOrder',
        type: NotificationType.NEW_ORDER_FOR_RESTAURANT,
        title: 'New order received',
        message: `A new order has been placed at your restaurant.`,
        realtimeEvent: 'order.new',
      });
    });

    this.eventBus.subscribe('order.status.changed', async (event) => {
      if (event.status !== 'CANCELLED') {
        return;
      }

      await this.notifyRestaurant({
        restaurantId: event.restaurantId,
        orderId: event.orderId,
        preferenceKey: 'notifyOnOrderCancelled',
        type: NotificationType.ORDER_CANCELLED_FOR_RESTAURANT,
        title: 'Order cancelled',
        message: `Order ${event.orderId} was cancelled.`,
        realtimeEvent: 'order.cancelled',
      });
    });

    // Sprint 1.8 — renamed from 'order.refunded.restaurant': the same event now also drives a
    // customer-facing notification (OrderNotificationListener), so a restaurant-scoped name was
    // no longer accurate. Payload additionally carries customerId for that second listener.
    this.eventBus.subscribe('order.refund.completed', async (event) => {
      await this.notifyRestaurant({
        restaurantId: event.restaurantId,
        orderId: event.orderId,
        preferenceKey: 'notifyOnRefund',
        type: NotificationType.REFUND_FOR_RESTAURANT,
        title: 'Order refunded',
        message: `A refund of ${event.amount} was issued for order ${event.orderId}.`,
        realtimeEvent: 'order.refunded',
      });
    });

    this.eventBus.subscribe('order.customer.message', async (event) => {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        select: { restaurantId: true },
      });

      if (!order) {
        return;
      }

      await this.notifyRestaurant({
        restaurantId: order.restaurantId,
        orderId: event.orderId,
        preferenceKey: 'notifyOnCustomerMessage',
        type: NotificationType.CUSTOMER_MESSAGE_FOR_RESTAURANT,
        title: 'New customer message',
        message: event.message,
        realtimeEvent: 'order.customer-message',
      });
    });
  }

  private async notifyRestaurant(params: {
    restaurantId: string;
    orderId: string;
    preferenceKey: keyof RestaurantNotificationPreferences;
    type: NotificationType;
    title: string;
    message: string;
    realtimeEvent: string;
  }): Promise<void> {
    try {
      const preferences = await getRestaurantNotificationPreferences(
        this.prisma,
        params.restaurantId,
      );

      if (!preferences[params.preferenceKey]) {
        return;
      }

      const recipientIds = await getActiveRestaurantRecipientIds(
        this.prisma,
        params.restaurantId,
      );

      await Promise.all(
        recipientIds.map((userId) =>
          this.notificationsService.createNotification(
            userId,
            params.type,
            params.title,
            params.message,
            { referenceType: 'ORDER', referenceId: params.orderId },
          ),
        ),
      );

      this.realtimeService.emitToRestaurant(
        params.restaurantId,
        params.realtimeEvent,
        {
          orderId: params.orderId,
          restaurantId: params.restaurantId,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify restaurant ${params.restaurantId} for ${params.realtimeEvent}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
