import { Injectable, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { QueueService } from '../../../infrastructure/queues/queue.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

/**
 * Production Readiness Stage A (Event Reliability): previously called
 * `DispatchService.assignOrder()` directly, in-process — `EventBusService.publish()` only logs a
 * handler's rejection (see its own doc comment), so a transient failure here (a momentary DB blip
 * while `assignOrder()` queries available partners, for example) silently dropped the assignment
 * attempt forever, with nothing else in the system re-scanning for "an order ready for pickup
 * with no delivery partner" the way `PaymentReconciliationService` already re-scans pending
 * payments every 5 minutes. Each event now enqueues a `dispatch-assignment` job
 * (`QueueService.addDispatchAssignmentJob`) instead, handled by `AssignmentExpiryProcessor` —
 * same `assignOrder()` call, same idempotent behavior, now with BullMQ's durability and
 * retry/backoff (`QueueInfrastructureModule`'s `defaultJobOptions`) covering the transient case.
 */
@Injectable()
export class DispatchListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,

    private readonly queueService: QueueService,

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

        await this.queueService.addDispatchAssignmentJob(
          event.orderId,
          'order.ready',
        );
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

        await this.queueService.addDispatchAssignmentJob(
          event.orderId,
          'dispatch.assignment.rejected',
        );
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

        await this.queueService.addDispatchAssignmentJob(
          event.orderId,
          'dispatch.assignment.expired',
        );
      },
    );
  }
}
