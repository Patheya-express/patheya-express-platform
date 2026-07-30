import { Injectable, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { DispatchService } from '../services/dispatch.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

@Injectable()
export class DispatchListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,

    private readonly dispatchService: DispatchService,

    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      'order.ready',

      async (event) => {
        this.logger.log(
          {
            event: 'dispatch_listener_received',
            sourceEvent: 'order.ready',
            orderId: event.orderId,
          },
          'DispatchListener',
        );

        await this.dispatchService.assignOrder(event.orderId);
      },
    );

    this.eventBus.subscribe(
      'dispatch.assignment.rejected',

      async (event) => {
        this.logger.log(
          {
            event: 'dispatch_listener_received',
            sourceEvent: 'dispatch.assignment.rejected',
            orderId: event.orderId,
            assignmentId: event.assignmentId,
          },
          'DispatchListener',
        );

        await this.dispatchService.assignOrder(event.orderId);
      },
    );

    this.eventBus.subscribe(
      'dispatch.assignment.expired',

      async (event) => {
        this.logger.log(
          {
            event: 'dispatch_listener_received',
            sourceEvent: 'dispatch.assignment.expired',
            orderId: event.orderId,
            assignmentId: event.assignmentId,
          },
          'DispatchListener',
        );

        await this.dispatchService.assignOrder(event.orderId);
      },
    );
  }
}
