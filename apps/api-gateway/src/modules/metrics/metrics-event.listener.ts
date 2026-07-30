import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { OrderStatus } from '@prisma/client';

import { EventBusService } from '../../core/events/event-bus.service';

import { PrismaService } from '../../infrastructure/database/prisma.service';

import { MetricsService } from './metrics.service';

/**
 * Production Readiness Stage B (Observability): records Orders/Payments metrics by subscribing
 * to domain events `OrdersService`/`PaymentsService` already publish (`order.placed`,
 * `order.status.changed`, `payment.success`, `payment.failed`, `payment.refunded`) — deliberately
 * NOT by injecting `MetricsService` into those services directly. Both have their own extensive
 * existing unit test suites that construct them with a fixed constructor argument list; adding a
 * new required dependency there would break every one of those tests for a change that's pure
 * instrumentation, not business logic. `EventBusService` is this codebase's own established
 * cross-cutting mechanism for exactly this kind of "something happened, react to it" concern
 * (`OrderNotificationListener`/`DispatchListener` already work this way) — this listener follows
 * that same pattern, at zero risk to either service's tests or constructors.
 *
 * Order/payment lifecycle *duration* isn't tracked via an in-memory map of start times (which
 * would leak for any order/payment that never reaches a terminal state) — instead, the
 * terminal-event handler reads the row's own `createdAt` from the database, the same "compute
 * duration from a persisted timestamp" approach used throughout this codebase already (e.g.
 * `PrismaService`'s own slow-query timing).
 */
@Injectable()
export class MetricsEventListener implements OnModuleInit {
  private readonly logger = new Logger(MetricsEventListener.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe('order.placed', async () => {
      this.metrics.recordOrderCreated();
    });

    this.eventBus.subscribe(
      'order.status.changed',
      async (event: { orderId: string; status: string }) => {
        if (event.status !== OrderStatus.DELIVERED && event.status !== OrderStatus.CANCELLED) {
          return;
        }

        const lifecycleDurationSeconds = await this.getElapsedSeconds(
          'order',
          event.orderId,
        );

        if (event.status === OrderStatus.DELIVERED) {
          this.metrics.recordOrderCompleted(lifecycleDurationSeconds);
        } else {
          this.metrics.recordOrderCancelled(lifecycleDurationSeconds);
        }
      },
    );

    this.eventBus.subscribe(
      'payment.success',
      async (event: { paymentId: string | null }) => {
        const latencySeconds = event.paymentId
          ? await this.getElapsedSeconds('payment', event.paymentId)
          : undefined;

        this.metrics.recordPaymentSuccess(latencySeconds);
      },
    );

    this.eventBus.subscribe(
      'payment.failed',
      async (event: { paymentId: string | null }) => {
        const latencySeconds = event.paymentId
          ? await this.getElapsedSeconds('payment', event.paymentId)
          : undefined;

        this.metrics.recordPaymentFailed(latencySeconds);
      },
    );

    this.eventBus.subscribe(
      'payment.refunded',
      async (event: { paymentId: string }) => {
        const refundDurationSeconds = await this.getElapsedSeconds(
          'payment',
          event.paymentId,
        );

        this.metrics.recordPaymentRefunded(refundDurationSeconds);
      },
    );
  }

  /** `createdAt` on the relevant row, to now, in seconds — `undefined` (metric observed without a
   *  duration sample) if the row can't be found or the read fails, since this is purely
   *  observability and must never affect the outcome of the business event it's reacting to. */
  private async getElapsedSeconds(
    entity: 'order' | 'payment',
    id: string,
  ): Promise<number | undefined> {
    try {
      const row =
        entity === 'order'
          ? await this.prisma.order.findUnique({
              where: { id },
              select: { createdAt: true },
            })
          : await this.prisma.payment.findUnique({
              where: { id },
              select: { createdAt: true },
            });

      if (!row) {
        return undefined;
      }

      return (Date.now() - row.createdAt.getTime()) / 1000;
    } catch (error) {
      this.logger.warn(
        `Failed to compute ${entity} duration metric for ${id}: ${String(error)}`,
      );

      return undefined;
    }
  }
}
