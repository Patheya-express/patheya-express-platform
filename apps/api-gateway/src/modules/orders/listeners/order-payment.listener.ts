import { Injectable, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { OrdersService } from '../services/orders.service';

@Injectable()
export class OrderPaymentListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,

    private readonly ordersService: OrdersService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe('payment.success', async (event) => {
      await this.ordersService.markOrderPaid(event.orderId);
    });

    this.eventBus.subscribe('payment.failed', async (event) => {
      await this.ordersService.markOrderPaymentFailed(event.orderId);
    });
  }
}
