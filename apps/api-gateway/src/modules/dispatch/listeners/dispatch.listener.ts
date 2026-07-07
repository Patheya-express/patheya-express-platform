import { Injectable, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { DispatchService } from '../services/dispatch.service';

@Injectable()
export class DispatchListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,

    private readonly dispatchService: DispatchService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      'order.ready',

      async (event) => {
        await this.dispatchService.assignOrder(event.orderId);
      },
    );

    this.eventBus.subscribe(
      'dispatch.assignment.rejected',

      async (event) => {
        await this.dispatchService.assignOrder(event.orderId);
      },
    );

    this.eventBus.subscribe(
      'dispatch.assignment.expired',

      async (event) => {
        await this.dispatchService.assignOrder(event.orderId);
      },
    );
  }
}
