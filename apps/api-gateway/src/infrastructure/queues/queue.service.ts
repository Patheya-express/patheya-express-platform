import { Injectable } from '@nestjs/common';

import { InjectQueue } from '@nestjs/bullmq';

import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('dispatch')
    private readonly dispatchQueue: Queue,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,

    @InjectQueue('payments')
    private readonly paymentsQueue: Queue,

    @InjectQueue('search')
    private readonly searchQueue: Queue,

    @InjectQueue('tickets')
    private readonly ticketsQueue: Queue,

    @InjectQueue('orders')
    private readonly ordersQueue: Queue,
  ) {}

  async addNotificationJob(data: any) {
    return this.notificationQueue.add(
      'send-notification',

      data,
    );
  }
  async addAssignmentExpiryJob(assignmentId: string) {
    return this.dispatchQueue.add(
      'assignment-expiry',

      {
        assignmentId,
      },

      {
        delay: 10 * 60 * 1000,
      },
    );
  }
  /**
   * Delayed one-shot job, same pattern as addAssignmentExpiryJob — but the delay is dynamic
   * (per-restaurant RestaurantSettings.acceptanceTimeoutMinutes) rather than a fixed constant.
   * The job id is set to the orderId so a restart-safe re-schedule (if ever needed) would
   * de-duplicate rather than stack a second timer for the same order.
   */
  async addOrderAcceptanceTimeoutJob(orderId: string, delayMs: number) {
    return this.ordersQueue.add(
      'order-acceptance-timeout',

      {
        orderId,
      },

      {
        delay: delayMs,
        // BullMQ rejects custom job ids containing ":" (reserved as its own Redis key
        // delimiter) — a "-" keeps the same restart-safe, per-order dedup intent.
        jobId: `order-acceptance-timeout-${orderId}`,
      },
    );
  }

  async addPaymentReconciliationJob() {
    return this.paymentsQueue.upsertJobScheduler(
      'payment-reconciliation',

      {
        every: 5 * 60 * 1000,
      },

      {
        name: 'reconcile-pending-payments',

        data: {},
      },
    );
  }

  async addTrendingSearchAggregationJob() {
    return this.searchQueue.upsertJobScheduler(
      'trending-search-aggregation',

      {
        every: 15 * 60 * 1000,
      },

      {
        name: 'aggregate-trending-searches',

        data: {},
      },
    );
  }

  async addTicketEscalationJob() {
    return this.ticketsQueue.upsertJobScheduler(
      'ticket-escalation',

      {
        every: 30 * 60 * 1000,
      },

      {
        name: 'escalate-overdue-tickets',

        data: {},
      },
    );
  }

  /**
   * Used by `MetricsService` to publish `patheya_bullmq_queue_depth` (docs/ci-cd aside —
   * modules/observability/prometheus-rules.tf's `patheya:bullmq_queue_depth:current` recording
   * rule and the "Application Overview" Grafana dashboard were both built already expecting this
   * exact metric name; this is the one place that satisfies it). "Depth" = waiting + delayed +
   * active, matching what an operator actually means by "how much work is queued" — completed/
   * failed counts are a different, already-alerted-on concern (Section 12's
   * Warning-Worker-JobFailed).
   */
  async getQueueDepths(): Promise<Record<string, number>> {
    const queues: Record<string, Queue> = {
      dispatch: this.dispatchQueue,
      notifications: this.notificationQueue,
      payments: this.paymentsQueue,
      search: this.searchQueue,
      tickets: this.ticketsQueue,
      orders: this.ordersQueue,
    };

    const entries = await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        const counts = await queue.getJobCounts('waiting', 'delayed', 'active');

        const depth =
          (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);

        return [name, depth] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  /**
   * Used by the readiness probe (LH1-10). Every queue shares the same Redis connection
   * (registered once via `BullModule.forRoot`), so checking one queue's client is representative
   * of all of them — this deliberately checks one, not all five, to keep the probe fast.
   * `IRedisClient` (BullMQ's adapter-agnostic client interface) doesn't declare `ping`, so this
   * reads `status` instead — `'ready'` is the same "connected and accepting commands" signal
   * ioredis (the adapter actually in use here) exposes. A 2-second timeout keeps an unreachable
   * Redis from hanging the readiness check indefinitely.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const client = await Promise.race([
        this.notificationQueue.client,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('queue health check timed out')),
            2000,
          ),
        ),
      ]);

      return client.status === 'ready';
    } catch {
      return false;
    }
  }
}
