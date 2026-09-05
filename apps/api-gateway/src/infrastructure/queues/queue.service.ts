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
  /**
   * Enterprise Dispatch Engine Enhancement — `delayMs` is now caller-supplied instead of a
   * hardcoded 10 minutes, so DispatchService's DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS (env-configurable,
   * default 15s) actually controls how long an offer stays PENDING before this job expires it.
   * Defaults to the old 10-minute value only as a safety net for any caller that omits it — the
   * one real caller (DispatchService.assignOrder) always passes it explicitly today.
   */
  async addAssignmentExpiryJob(assignmentId: string, delayMs = 10 * 60 * 1000) {
    return this.dispatchQueue.add(
      'assignment-expiry',

      {
        assignmentId,
      },

      {
        delay: delayMs,
      },
    );
  }

  /**
   * Production Readiness Stage A (Event Reliability): `DispatchListener` used to call
   * `DispatchService.assignOrder()` directly from its `EventBusService` handler — in-memory,
   * fire-and-forget, no retry. Since `EventBusService.publish()` catches and only *logs* a
   * handler's rejection, a transient failure (a momentary DB blip while querying available
   * partners, for example) silently dropped the assignment attempt forever: nothing else in the
   * system re-scans for "an order that's `READY_FOR_PICKUP` with no delivery partner assigned"
   * (unlike payments, which `PaymentReconciliationService` already re-scans every 5 minutes).
   * Routing this through the `dispatch` queue instead gives it BullMQ's durability (the job
   * survives a process crash once enqueued) and the retry/backoff `QueueInfrastructureModule`'s
   * `defaultJobOptions` now applies. `DispatchAssignmentProcessor` calls the exact same
   * `DispatchService.assignOrder()` — already documented and written to be idempotent/safe to
   * call repeatedly for the same order — so retries (or this job racing the same order via a
   * different trigger) are safe by construction, not something this change had to add.
   */
  /**
   * Enterprise Dispatch Engine Enhancement — `delayMs` is new and optional. Every pre-existing
   * caller (DispatchListener's three subscriptions, DispatchReconciliationService) calls this with
   * two arguments and is unaffected — `delay` is only set on the options object when a delay is
   * actually supplied, so an omitted third argument enqueues immediately exactly as before. Only
   * DispatchService's new "cycle exhausted, schedule the next cycle" path passes it, reusing this
   * same queue/job name rather than introducing a new one.
   */
  async addDispatchAssignmentJob(
    orderId: string,
    sourceEvent: string,
    delayMs?: number,
    // Enterprise Dispatch Engine Enhancement — carries the NEXT cycle number for the one caller
    // that needs to force it (DispatchService's "this cycle is exhausted" retry path). This is
    // load-bearing, not cosmetic: when a cycle exhausts with zero eligible partners, no new
    // DeliveryAssignment row is ever written, so there is nothing in the DB for a future
    // assignOrder() call to derive "we're now on cycle 2" from — the job payload is the only
    // place that fact can survive until the delayed retry fires. Every pre-existing caller
    // (DispatchListener's three subscriptions, DispatchReconciliationService) omits this and
    // keeps deriving cycle from the DB exactly as before, which is correct for them: a real
    // assignment row already exists in those cases.
    cycle?: number,
  ) {
    return this.dispatchQueue.add(
      'dispatch-assignment',
      { orderId, sourceEvent, ...(cycle !== undefined ? { cycle } : {}) },
      delayMs ? { delay: delayMs } : undefined,
    );
  }

  /**
   * Production Readiness Stage A (Crash Recovery) — same repeatable-job pattern as
   * `addPaymentReconciliationJob`, applied to `DispatchReconciliationService`'s periodic re-scan
   * for stranded ready-for-pickup orders.
   */
  async addDispatchReconciliationJob() {
    return this.dispatchQueue.upsertJobScheduler(
      'dispatch-reconciliation',

      {
        every: 5 * 60 * 1000,
      },

      {
        name: 'dispatch-reconciliation',

        data: {},
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
   * Production Readiness Stage B (Observability): per-state breakdown `getQueueDepths()`
   * deliberately collapses into one "depth" figure (see its own doc comment — that combined
   * number is what an existing Grafana dashboard/recording rule already expects, so it's kept
   * exactly as-is). `MetricsService` needs the individual waiting/active/delayed counts, plus the
   * age of the oldest waiting job, to expose them as separate labels — this is a new, additive
   * method rather than a change to the existing one.
   */
  async getQueueJobCounts(): Promise<
    Record<
      string,
      {
        waiting: number;
        active: number;
        delayed: number;
        oldestWaitingAgeSeconds: number;
      }
    >
  > {
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
        const [counts, oldestWaiting] = await Promise.all([
          queue.getJobCounts('waiting', 'delayed', 'active'),
          queue.getWaiting(0, 0),
        ]);

        const oldestWaitingAgeSeconds =
          oldestWaiting.length > 0
            ? (Date.now() - oldestWaiting[0].timestamp) / 1000
            : 0;

        return [
          name,
          {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            oldestWaitingAgeSeconds,
          },
        ] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  /**
   * Production Readiness Stage B (Observability): looks up a single job by queue name + id —
   * `MetricsService` uses this to read `processedOn`/`finishedOn`/`attemptsMade` off a job that
   * just completed or failed (none of which are in the terse QueueEvents `completed`/`failed`
   * payload itself). Queue instances are private constructor fields, so this is the one place
   * outside this class that can resolve a queue name to its `Queue` object.
   */
  async getJob(queueName: string, jobId: string) {
    const queues: Record<string, Queue> = {
      dispatch: this.dispatchQueue,
      notifications: this.notificationQueue,
      payments: this.paymentsQueue,
      search: this.searchQueue,
      tickets: this.ticketsQueue,
      orders: this.ordersQueue,
    };

    const queue = queues[queueName];

    if (!queue) {
      return undefined;
    }

    return queue.getJob(jobId);
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
