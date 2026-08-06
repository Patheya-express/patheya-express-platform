import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';

import { QueueEvents } from 'bullmq';

import type { Redis } from 'ioredis';

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import { QueueService } from '../../infrastructure/queues/queue.service';

import { RedisConnectionFactory } from '../../infrastructure/redis-infrastructure/redis-connection-factory.service';
import { RedisConfigurationService } from '../../infrastructure/redis-infrastructure/redis-configuration.service';
import { RedisConnectionType } from '../../infrastructure/redis-infrastructure/enums/redis-connection-type.enum';
import { RedisMetricsService } from '../../infrastructure/redis-infrastructure/redis-metrics.service';
import { PresenceService } from '../presence/services/presence.service';

const QUEUE_DEPTH_POLL_INTERVAL_MS = 15_000;

// Matches queue.service.ts's own six `@InjectQueue` names exactly.
const QUEUE_NAMES = [
  'dispatch',
  'notifications',
  'payments',
  'search',
  'tickets',
  'orders',
];

/**
 * Names match exactly what modules/observability/prometheus-rules.tf's recording rules
 * (`patheya:http_requests:rate5m`, `patheya:bullmq_queue_depth:current`, etc.) and the
 * "Application Overview" Grafana dashboard (Terraform repo) were already built expecting —
 * platform-standards.md Section 12's naming convention (`patheya_<domain>_<metric>_<unit>`).
 * Both `app.kubernetes.io/name`'s value (via the `app` label here, sourced from `APP_NAME`) and
 * the k8s ServiceMonitor's own job label distinguish api-gateway from workers on the same charts.
 *
 * Production Readiness Stage B (Observability) extended this with per-subsystem metrics
 * (BullMQ job-state breakdown/duration/retries, Dispatch, Orders, Payments, Socket.IO, Storage,
 * Redis, Prisma) — every new metric registers into this SAME `Registry` (never a second
 * collector), matching the existing "one MetricsService, one registry" pattern rather than
 * introducing a new metrics library or a second `/metrics`-adjacent endpoint.
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);

  private readonly registry = new Registry();

  private readonly appName = process.env.APP_NAME || 'api-gateway';

  // ---------------------------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------------------------

  private readonly httpRequestsTotal = new Counter({
    name: 'patheya_http_requests_total',
    help: 'Total HTTP requests handled, by app/method/route/status',
    labelNames: ['app', 'method', 'route', 'status'],
    registers: [this.registry],
  });

  private readonly httpRequestDurationSeconds = new Histogram({
    name: 'patheya_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by app/method/route',
    labelNames: ['app', 'method', 'route'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  /** Audit finding (Workstream 1): no in-flight/concurrency gauge existed — request count and
   *  duration alone can't distinguish "many short requests" from "a pile-up of slow ones". */
  private readonly httpRequestsInFlight = new Gauge({
    name: 'patheya_http_requests_in_flight',
    help: 'Number of HTTP requests currently being processed',
    labelNames: ['app'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // BullMQ
  // ---------------------------------------------------------------------------------------------

  /** Kept exactly as-is (name, meaning, poll cadence) — an existing Grafana dashboard and
   *  Terraform recording rule already depend on this combined figure. */
  private readonly bullmqQueueDepth = new Gauge({
    name: 'patheya_bullmq_queue_depth',
    help: 'Current BullMQ queue depth (waiting + delayed + active), by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  private readonly bullmqJobsFailedTotal = new Counter({
    name: 'patheya_bullmq_jobs_failed_total',
    help: 'Total BullMQ jobs that exhausted their retries, by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  /** Audit finding: the combined `bullmq_queue_depth` gauge cannot distinguish "a backlog of
   *  waiting work" from "many jobs delayed on purpose" from "workers actively churning through
   *  a burst" — each needs its own operational response, so each gets its own gauge. */
  private readonly bullmqJobsWaiting = new Gauge({
    name: 'patheya_bullmq_jobs_waiting',
    help: 'Current number of waiting jobs, by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  private readonly bullmqJobsActive = new Gauge({
    name: 'patheya_bullmq_jobs_active',
    help: 'Current number of active (currently processing) jobs, by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  private readonly bullmqJobsDelayed = new Gauge({
    name: 'patheya_bullmq_jobs_delayed',
    help: 'Current number of delayed jobs (scheduled or awaiting retry backoff), by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  /** Audit finding: only failures were ever counted — there was no way to tell a healthy,
   *  churning queue from one that had simply stopped being used. */
  private readonly bullmqJobsCompletedTotal = new Counter({
    name: 'patheya_bullmq_jobs_completed_total',
    help: 'Total BullMQ jobs that completed successfully, by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  /** `processedOn`/`finishedOn` (BullMQ's own job timestamps, fetched via `queue.getJob()` in the
   *  `completed`/`failed` handlers below) — no separate timing instrumentation needed per queue. */
  private readonly bullmqJobDurationSeconds = new Histogram({
    name: 'patheya_bullmq_job_duration_seconds',
    help: 'BullMQ job processing duration in seconds (processedOn to finishedOn), by queue and outcome',
    labelNames: ['queue', 'outcome'],
    buckets: [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [this.registry],
  });

  /** Derived from `job.attemptsMade` on the *terminal* completed/failed event — BullMQ's own
   *  'failed' stream event only fires on terminal failure, never per intermediate retry (verified
   *  against `bullmq`'s source, Stage A), so this is the only place retry counts are observable
   *  without per-processor instrumentation. */
  private readonly bullmqJobRetriesTotal = new Counter({
    name: 'patheya_bullmq_job_retries_total',
    help: 'Total retry attempts across finished (completed or failed) BullMQ jobs, by queue',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  private readonly bullmqOldestWaitingJobAgeSeconds = new Gauge({
    name: 'patheya_bullmq_oldest_waiting_job_age_seconds',
    help: 'Age in seconds of the oldest waiting job, by queue (0 if none waiting)',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------------------------

  private readonly dispatchAssignmentAttemptsTotal = new Counter({
    name: 'patheya_dispatch_assignment_attempts_total',
    help: 'Total dispatch assignment attempts, by trigger source (order.ready, rejected, expired, reconciliation)',
    labelNames: ['source'],
    registers: [this.registry],
  });

  private readonly dispatchAssignmentDurationSeconds = new Histogram({
    name: 'patheya_dispatch_assignment_duration_seconds',
    help: 'Duration of DispatchService.assignOrder() calls in seconds',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  private readonly dispatchRedispatchTotal = new Counter({
    name: 'patheya_dispatch_redispatch_total',
    help: 'Total redispatch attempts (an assignment was rejected or expired, triggering reassignment)',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  private readonly dispatchReconciliationRunsTotal = new Counter({
    name: 'patheya_dispatch_reconciliation_runs_total',
    help: 'Total dispatch reconciliation scan runs',
    registers: [this.registry],
  });

  private readonly dispatchOrdersAwaitingAssignment = new Gauge({
    name: 'patheya_dispatch_orders_awaiting_assignment',
    help: 'Number of stranded ready-for-pickup orders found in the most recent reconciliation scan',
    registers: [this.registry],
  });

  // Enterprise Dispatch Engine Enhancement — cycle-based redispatch, configurable acceptance
  // window, and deterministic priority ordering. Each metric below has a single, unambiguous
  // trigger point (documented on its recordX() method) so a dashboard built on these can
  // distinguish "a normal reject/timeout redispatch within a cycle" (dispatchRedispatchTotal,
  // pre-existing) from "every partner in a cycle was exhausted" (dispatchCycleRetryTotal) from
  // "the order gave up entirely" (dispatchMaxCyclesTotal).

  private readonly dispatchCycleTotal = new Counter({
    name: 'patheya_dispatch_cycle_total',
    help: 'Total dispatch cycles started (one per full pass through the eligible partner pool)',
    registers: [this.registry],
  });

  private readonly dispatchCycleRetryTotal = new Counter({
    name: 'patheya_dispatch_cycle_retry_total',
    help: 'Total times a dispatch cycle was exhausted and a new cycle was scheduled',
    registers: [this.registry],
  });

  private readonly dispatchAssignmentTimeoutTotal = new Counter({
    name: 'patheya_dispatch_assignment_timeout_total',
    help: 'Total delivery-assignment offers that expired unanswered (PENDING to EXPIRED)',
    registers: [this.registry],
  });

  private readonly dispatchPartnerAcceptTotal = new Counter({
    name: 'patheya_dispatch_partner_accept_total',
    help: 'Total delivery-assignment offers accepted by a partner',
    registers: [this.registry],
  });

  private readonly dispatchPartnerRejectTotal = new Counter({
    name: 'patheya_dispatch_partner_reject_total',
    help: 'Total delivery-assignment offers explicitly rejected by a partner',
    registers: [this.registry],
  });

  private readonly dispatchCompletedTotal = new Counter({
    name: 'patheya_dispatch_completed_total',
    help: 'Total orders that reached a successful delivery-partner assignment (accepted)',
    registers: [this.registry],
  });

  private readonly dispatchMaxCyclesTotal = new Counter({
    name: 'patheya_dispatch_max_cycles_total',
    help: 'Total orders that exhausted DISPATCH_MAX_CYCLES without any partner accepting',
    registers: [this.registry],
  });

  // Enterprise Dispatch Engine Enhancement — Phase 2 (unlimited mode, round-robin fairness,
  // rejection cooldown). Same "one Registry, additive counters" pattern as Phase 1's dispatch
  // metrics above.

  private readonly dispatchPartnerCooldownTotal = new Counter({
    name: 'patheya_dispatch_partner_cooldown_total',
    help: 'Total times a partner was excluded from an offer because their rejection cooldown for that order had not yet elapsed',
    registers: [this.registry],
  });

  private readonly dispatchUnlimitedCycleTotal = new Counter({
    name: 'patheya_dispatch_unlimited_cycle_total',
    help: 'Total cycle retries scheduled under DISPATCH_MAX_CYCLES=0 (unlimited mode)',
    registers: [this.registry],
  });

  private readonly dispatchCycleRotationTotal = new Counter({
    name: 'patheya_dispatch_cycle_rotation_total',
    help: 'Total times round-robin rotation actually changed which partner started a cycle',
    registers: [this.registry],
  });

  // Phase 3 (Change 5 — observability). `dispatch_partner_skipped_cooldown` was explicitly
  // requested but is deliberately NOT added here — it would be a second counter measuring the
  // exact same event `patheya_dispatch_partner_cooldown_total` above already measures (Phase 2),
  // which the "no duplicated code" non-functional requirement for this phase rules out; that
  // existing metric already satisfies the ask under its Phase 2 name. Every other requested
  // metric name below is genuinely new.

  /** Histogram, not a hand-maintained running average — Prometheus best practice is sum/count via
   *  PromQL rather than a service computing its own average, and a Histogram additionally exposes
   *  percentiles the literal metric name alone wouldn't. Observed once per successful accept, as
   *  `respondedAt - assignedAt` on that one PENDING-to-ACCEPTED assignment (the offer's own
   *  acceptance latency) — not cross-cycle total dispatch time from order-ready, which would need
   *  a new join to OrderStatusHistory this phase doesn't otherwise require. */
  private readonly dispatchAverageAssignmentSeconds = new Histogram({
    name: 'patheya_dispatch_average_assignment_seconds',
    help: 'Duration in seconds between an assignment being offered and accepted',
    buckets: [1, 2, 5, 10, 15, 30, 60, 120],
    registers: [this.registry],
  });

  /** Same reasoning as above — a Histogram of the accepted assignment's own `cycle` value, so
   *  average/percentile cycle count to a successful acceptance is queryable, without this service
   *  maintaining a running mean itself. */
  private readonly dispatchAverageCycles = new Histogram({
    name: 'patheya_dispatch_average_cycles',
    help: 'Cycle number at which an assignment was successfully accepted',
    buckets: [1, 2, 3, 5, 10, 20, 50],
    registers: [this.registry],
  });

  private readonly dispatchPartnerSkippedRateLimitTotal = new Counter({
    name: 'patheya_dispatch_partner_skipped_rate_limit_total',
    help: 'Total times a partner was excluded from an offer because DISPATCH_MAX_ASSIGNMENTS_PER_MINUTE had already been reached',
    registers: [this.registry],
  });

  private readonly dispatchPartnerSkippedOfflineTotal = new Counter({
    name: 'patheya_dispatch_partner_skipped_offline_total',
    help: 'Total times a partner was excluded from an offer because their Redis presence check found them offline',
    registers: [this.registry],
  });

  private readonly dispatchPartnerSkippedActiveAssignmentTotal = new Counter({
    name: 'patheya_dispatch_partner_skipped_active_assignment_total',
    help: 'Total times a partner was excluded from an offer because they already hold a PENDING/ACCEPTED assignment elsewhere',
    registers: [this.registry],
  });

  /** Not an exclusion — distance is a ranking criterion, never a filter. Incremented when a
   *  candidate reaching the priority ranking is missing the coordinates (its own, or the order's
   *  pickup branch's) needed to compute a real distance, so it was ranked blind on that criterion
   *  instead of by actual proximity — an observability signal for "how often is location data
   *  missing," not a skip/exclusion in the same sense as the counters above. */
  private readonly dispatchPartnerSkippedDistanceTotal = new Counter({
    name: 'patheya_dispatch_partner_skipped_distance_total',
    help: 'Total times a candidate partner was ranked without a real distance value due to missing coordinates',
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------------------------

  private readonly ordersCreatedTotal = new Counter({
    name: 'patheya_orders_created_total',
    help: 'Total orders placed',
    registers: [this.registry],
  });

  private readonly ordersCompletedTotal = new Counter({
    name: 'patheya_orders_completed_total',
    help: 'Total orders that reached DELIVERED',
    registers: [this.registry],
  });

  private readonly ordersCancelledTotal = new Counter({
    name: 'patheya_orders_cancelled_total',
    help: 'Total orders that reached CANCELLED',
    registers: [this.registry],
  });

  /** From `Order.createdAt` (queried once, on the terminal `order.status.changed` event) to now —
   *  not tracked in-memory per order, which would leak for any order that never reaches a
   *  terminal status. */
  private readonly orderLifecycleDurationSeconds = new Histogram({
    name: 'patheya_order_lifecycle_duration_seconds',
    help: 'Duration in seconds from order creation to a terminal status (delivered or cancelled)',
    labelNames: ['outcome'],
    buckets: [60, 300, 600, 1200, 1800, 3600, 7200, 14400],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------------------------

  private readonly paymentsSuccessTotal = new Counter({
    name: 'patheya_payments_success_total',
    help: 'Total successful payments',
    registers: [this.registry],
  });

  private readonly paymentsFailedTotal = new Counter({
    name: 'patheya_payments_failed_total',
    help: 'Total failed payments',
    registers: [this.registry],
  });

  private readonly paymentsRefundedTotal = new Counter({
    name: 'patheya_payments_refunded_total',
    help: 'Total refunded payments',
    registers: [this.registry],
  });

  /** From `Payment.createdAt` to the success/failure event — same reasoning as
   *  `orderLifecycleDurationSeconds` for why this is a DB read, not an in-memory map. */
  private readonly paymentLatencySeconds = new Histogram({
    name: 'patheya_payment_latency_seconds',
    help: 'Duration in seconds from payment creation to success or failure',
    labelNames: ['outcome'],
    buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    registers: [this.registry],
  });

  private readonly refundDurationSeconds = new Histogram({
    name: 'patheya_refund_duration_seconds',
    help: 'Duration in seconds from payment creation to refund completion',
    buckets: [60, 300, 600, 1800, 3600, 14400, 86400],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Socket.IO
  // ---------------------------------------------------------------------------------------------

  private readonly socketioConnectionsTotal = new Counter({
    name: 'patheya_socketio_connections_total',
    help: 'Total Socket.IO connections accepted',
    registers: [this.registry],
  });

  private readonly socketioDisconnectionsTotal = new Counter({
    name: 'patheya_socketio_disconnections_total',
    help: 'Total Socket.IO disconnections',
    registers: [this.registry],
  });

  /** Process-local (this pod's own connected sockets) — sum across pods in Grafana for the
   *  cluster-wide total, the same way every other per-pod gauge here is meant to be queried. */
  private readonly socketioConnectedClients = new Gauge({
    name: 'patheya_socketio_connected_clients',
    help: 'Number of Socket.IO clients currently connected to this process',
    registers: [this.registry],
  });

  private readonly socketioBroadcastsTotal = new Counter({
    name: 'patheya_socketio_broadcasts_total',
    help: 'Total Socket.IO room broadcasts, by room type',
    labelNames: ['room_type'],
    registers: [this.registry],
  });

  private readonly socketioEventsEmittedTotal = new Counter({
    name: 'patheya_socketio_events_emitted_total',
    help: 'Total Socket.IO events emitted, by event name',
    labelNames: ['event'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------------------------

  private readonly storageUploadDurationSeconds = new Histogram({
    name: 'patheya_storage_upload_duration_seconds',
    help: 'Storage upload duration in seconds',
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly storageUploadFailuresTotal = new Counter({
    name: 'patheya_storage_upload_failures_total',
    help: 'Total storage upload failures',
    registers: [this.registry],
  });

  private readonly storageDownloadFailuresTotal = new Counter({
    name: 'patheya_storage_download_failures_total',
    help: 'Total storage download/read failures',
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Redis (bridged from RedisMetricsService — see its own doc comment: "no Prometheus export...
  // that stays MetricsService's job", written during the Redis Infrastructure migration
  // specifically anticipating this. `collect()` re-reads the live snapshot on every scrape, so
  // these are always current without a separate poll loop.)
  // ---------------------------------------------------------------------------------------------

  private readonly redisReconnectCount = new Gauge({
    name: 'patheya_redis_reconnect_count',
    help: 'Total Redis reconnect events observed by this process, across all registered connections',
    registers: [this.registry],
    collect: () => {
      this.redisReconnectCount.set(
        this.redisMetrics.getSnapshot().reconnectCount,
      );
    },
  });

  private readonly redisDisconnectCount = new Gauge({
    name: 'patheya_redis_disconnect_count',
    help: 'Total Redis disconnect events observed by this process, across all registered connections',
    registers: [this.registry],
    collect: () => {
      this.redisDisconnectCount.set(
        this.redisMetrics.getSnapshot().disconnectCount,
      );
    },
  });

  private readonly redisAuthFailureCount = new Gauge({
    name: 'patheya_redis_auth_failure_count',
    help: 'Total Redis authentication failures observed by this process',
    registers: [this.registry],
    collect: () => {
      this.redisAuthFailureCount.set(
        this.redisMetrics.getSnapshot().authFailureCount,
      );
    },
  });

  private readonly redisActiveConnections = new Gauge({
    name: 'patheya_redis_active_connections',
    help: 'Number of Redis connections currently registered as active by this process',
    registers: [this.registry],
    collect: () => {
      this.redisActiveConnections.set(
        this.redisMetrics.getSnapshot().activeConnections,
      );
    },
  });

  private readonly redisAveragePingMs = new Gauge({
    name: 'patheya_redis_average_ping_ms',
    help: 'Rolling average Redis PING latency in milliseconds, across recent health-check samples',
    registers: [this.registry],
    collect: () => {
      const { averagePingMs } = this.redisMetrics.getSnapshot();
      this.redisAveragePingMs.set(averagePingMs ?? 0);
    },
  });

  // ---------------------------------------------------------------------------------------------
  // Prisma
  // ---------------------------------------------------------------------------------------------

  /** Not labeled by model/action: Prisma's `query` event exposes the raw SQL text, not a
   *  structured model/action pair, and parsing SQL to recover them reliably would be its own,
   *  separate piece of work (a Prisma Client Extension gives structured access to this — a
   *  legitimate follow-up, not attempted here to avoid an unreliable ad-hoc SQL parser). */
  private readonly prismaQueryDurationSeconds = new Histogram({
    name: 'patheya_prisma_query_duration_seconds',
    help: 'Prisma query duration in seconds',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly prismaQueryErrorsTotal = new Counter({
    name: 'patheya_prisma_query_errors_total',
    help: 'Total Prisma-reported query errors',
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // EventBus (Production Readiness Stage D)
  // ---------------------------------------------------------------------------------------------

  /** EventBusService.publish() catches and only *logs* a rejected handler — this is the only
   *  place that failure becomes visible to Prometheus/alerting rather than requiring a log
   *  search. Labeled by event name (a small, fixed set of string literals from call sites, not
   *  user input — safe cardinality). */
  private readonly eventBusEventsPublishedTotal = new Counter({
    name: 'patheya_event_bus_events_published_total',
    help: 'Total EventBusService.publish() calls, by event name',
    labelNames: ['event'],
    registers: [this.registry],
  });

  private readonly eventBusHandlerFailuresTotal = new Counter({
    name: 'patheya_event_bus_handler_failures_total',
    help: 'Total EventBusService subscriber handler rejections, by event name',
    labelNames: ['event'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Payment reconciliation (Production Readiness Stage D)
  // ---------------------------------------------------------------------------------------------

  /** Without this, PaymentReconciliationProcessor always reports its BullMQ job as "completed"
   *  even if every single payment in the sweep failed to reconcile (reconcileOne() catches and
   *  only logs per-payment errors) — a false-positive "healthy" signal on the one queue with no
   *  other business metric. Mirrors dispatchReconciliationRunsTotal/
   *  dispatchOrdersAwaitingAssignment's existing shape for the equivalent dispatch sweep. */
  private readonly paymentReconciliationRunsTotal = new Counter({
    name: 'patheya_payment_reconciliation_runs_total',
    help: 'Total payment reconciliation sweep runs',
    registers: [this.registry],
  });

  private readonly paymentReconciliationErrorsTotal = new Counter({
    name: 'patheya_payment_reconciliation_errors_total',
    help: 'Total per-payment errors encountered during payment reconciliation sweeps',
    registers: [this.registry],
  });

  private readonly paymentReconciliationPendingAfterSweep = new Gauge({
    name: 'patheya_payment_reconciliation_pending_after_sweep',
    help: 'Number of payments still PENDING after the most recent reconciliation sweep',
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Razorpay provider (Production Readiness Stage D)
  // ---------------------------------------------------------------------------------------------

  /** Distinct from the existing patheya_payment_latency_seconds (a business-flow duration from
   *  Payment.createdAt to the success/failure event — includes DB writes, webhook round-trip
   *  time from the customer's device, and queue delays). This times only the Razorpay SDK call
   *  itself, so "Razorpay is slow/erroring" is distinguishable from "our own verification logic
   *  has a bug." Labeled by operation, a small fixed set of string literals from call sites. */
  private readonly razorpayApiCallDurationSeconds = new Histogram({
    name: 'patheya_razorpay_api_call_duration_seconds',
    help: 'Razorpay SDK call duration in seconds, by operation',
    labelNames: ['operation'],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly razorpayApiCallFailuresTotal = new Counter({
    name: 'patheya_razorpay_api_call_failures_total',
    help: 'Total Razorpay SDK call failures, by operation',
    labelNames: ['operation'],
    registers: [this.registry],
  });

  // ---------------------------------------------------------------------------------------------
  // Presence (Production Readiness Stage D)
  // ---------------------------------------------------------------------------------------------

  /** Bridged from PresenceService's Redis-backed online sets, same pattern as the Redis-bridge
   *  gauges above (re-read on every scrape via collect(), not pushed). A leading indicator for
   *  dispatch capacity — "why is dispatch reconciliation finding stranded orders" often starts
   *  with "how many delivery partners are online right now," previously invisible to Prometheus. */
  private readonly supportAgentsOnline = new Gauge({
    name: 'patheya_support_agents_online',
    help: 'Number of support agents currently online (Redis presence set)',
    registers: [this.registry],
  });

  private readonly deliveryPartnersOnline = new Gauge({
    name: 'patheya_delivery_partners_online',
    help: 'Number of delivery partners currently online (Redis presence set)',
    registers: [this.registry],
  });

  private pollHandle?: ReturnType<typeof setInterval>;

  private presencePollHandle?: ReturnType<typeof setInterval>;

  private readonly queueEventListeners: QueueEvents[] = [];

  constructor(
    // RedisInfrastructureModule is @Global() and imported by both AppModule and WorkerModule, so
    // these are always available — not marked @Optional().
    private readonly redisConnectionFactory: RedisConnectionFactory,
    private readonly redisConfiguration: RedisConfigurationService,
    private readonly redisMetrics: RedisMetricsService,
    // MetricsModule imports PresenceCoreModule directly (Production Readiness Stage D) — always
    // available, not marked @Optional(), same as the three Redis-infrastructure deps above.
    private readonly presenceService: PresenceService,
    // Optional: worker-main.ts's WorkerModule does import QueueProducerModule (it needs the
    // processors), so QueueService is actually always available today — kept optional defensively, since a
    // future, further-slimmed process shape (e.g. a per-queue worker) shouldn't need this file to
    // change to stay safe without it.
    @Optional()
    private readonly queueService?: QueueService,
  ) {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'patheya_process_',
    });
  }

  onModuleInit(): void {
    // Production Readiness Stage D: independent of queueService's availability (unlike the
    // BullMQ-specific polling below) — presence is a plain Redis-backed feature, always safe to
    // poll on both the API and Worker processes.
    this.presencePollHandle = setInterval(() => {
      this.pollPresence().catch((error: unknown) => {
        this.logger.warn(`Presence poll failed: ${String(error)}`);
      });
    }, QUEUE_DEPTH_POLL_INTERVAL_MS);

    this.presencePollHandle.unref();

    if (!this.queueService) {
      return;
    }

    this.pollHandle = setInterval(() => {
      this.pollQueueDepths().catch((error: unknown) => {
        this.logger.warn(`Queue depth poll failed: ${String(error)}`);
      });
    }, QUEUE_DEPTH_POLL_INTERVAL_MS);

    this.pollHandle.unref();

    // One QueueEvents listener per queue — BullMQ's own recommended way to observe job-level
    // lifecycle events without touching each Processor's business logic (Section 17's
    // Warning-Worker-JobFailed-<queue> alert, prometheus-rules.tf, needs this counter to have any
    // data at all).
    for (const queueName of QUEUE_NAMES) {
      // Connection options sourced through RedisConfigurationService (Redis Infrastructure
      // migration) rather than importing `getRedisConnectionOptions()` directly — identical
      // values either way, since that service's `getDefaultOptions()` is that same function.
      // Deliberately still a plain options object, not a factory-constructed client: QueueEvents's
      // own constructor unconditionally `.duplicate()`s any already-constructed ioredis instance
      // handed to it as `connection` (see RedisConnectionFactory's migration-note doc comment),
      // so passing a live client here would create a second, unregistered connection and leak the
      // first. Letting QueueEvents build its own connection (exactly as before this migration)
      // and then registering the resulting client below is what avoids that.
      const events = new QueueEvents(queueName, {
        connection: this.redisConfiguration.getDefaultOptions(),
      });

      events.on('failed', ({ jobId, failedReason }) => {
        this.recordJobFailed(queueName);

        this.recordJobFinished(queueName, jobId, 'failed').catch(
          (error: unknown) => {
            this.logger.warn(
              `Failed to record job duration/retry metrics for "${queueName}"/${jobId}: ${String(error)}`,
            );
          },
        );

        this.logger.warn(
          `Job ${jobId} on queue "${queueName}" failed: ${failedReason}`,
        );
      });

      events.on('completed', ({ jobId }) => {
        this.bullmqJobsCompletedTotal.inc({ queue: queueName });

        this.recordJobFinished(queueName, jobId, 'completed').catch(
          (error: unknown) => {
            this.logger.warn(
              `Failed to record job duration/retry metrics for "${queueName}"/${jobId}: ${String(error)}`,
            );
          },
        );
      });

      // `events.client` is BullMQ's own accessor for the connection it just created — resolves
      // asynchronously once actually connected. Registered here (not awaited) so this stays
      // non-blocking: `onModuleInit` must keep returning immediately regardless of Redis
      // reachability, exactly as it did before this migration.
      events.client
        .then((client) => {
          // `events.client` resolves to BullMQ's `IRedisClient` adapter type — a `Proxy` that
          // forwards everything (including `.options` and `EventEmitter` methods, both of which
          // `registerExternalConnection` uses) straight through to the real underlying `ioredis`
          // instance (`this === target` for all forwarded calls; see `createIORedisClient` in
          // `bullmq`'s `classes/ioredis-client.js`). Structurally compatible with `Redis` for
          // every operation this factory performs on it, even though TS doesn't know that.
          this.redisConnectionFactory.registerExternalConnection(
            client as unknown as Redis,
            {
              name: `bullmq:queue-events:${queueName}`,
              type: RedisConnectionType.BULLMQ_QUEUE_EVENTS,
              owner: 'MetricsService',
              purpose: 'BullMQ QueueEvents monitoring',
            },
          );
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to register QueueEvents Redis connection for "${queueName}": ${String(error)}`,
          );
        });

      this.queueEventListeners.push(events);
    }
  }

  /**
   * Ownership: `MetricsService` still owns each `QueueEvents` instance and its shutdown, exactly
   * as before this migration — `events.close()` already quits that instance's underlying `ioredis`
   * client (confirmed in `bullmq`'s `RedisConnection.close()`: since we never pass a live client
   * as `connection` — see `onModuleInit`'s comment — `extraOptions.shared` is `false`, so `close()`
   * calls `this._client.quit()` on the exact connection `events.client` resolved to and that
   * `registerExternalConnection()` registered above). Registering a connection with
   * `RedisConnectionRegistry` does not transfer ownership or add a second thing to close — the
   * registry only observes; `QueueEvents.close()` remains the single place that actually closes
   * the socket, unchanged. No new cleanup code was needed here.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
    }

    if (this.presencePollHandle) {
      clearInterval(this.presencePollHandle);
    }

    await Promise.all(this.queueEventListeners.map((events) => events.close()));
  }

  private async pollPresence(): Promise<void> {
    const [agents, partners] = await Promise.all([
      this.presenceService.listOnlineAgentIds(),
      this.presenceService.countOnlinePartners(),
    ]);

    this.recordSupportAgentsOnline(agents.length);
    this.recordDeliveryPartnersOnline(partners);
  }

  private async pollQueueDepths(): Promise<void> {
    const depths = await this.queueService!.getQueueDepths();

    for (const [queue, depth] of Object.entries(depths)) {
      this.bullmqQueueDepth.set({ queue }, depth);
    }

    const jobCounts = await this.queueService!.getQueueJobCounts();

    for (const [queue, counts] of Object.entries(jobCounts)) {
      this.bullmqJobsWaiting.set({ queue }, counts.waiting);
      this.bullmqJobsActive.set({ queue }, counts.active);
      this.bullmqJobsDelayed.set({ queue }, counts.delayed);
      this.bullmqOldestWaitingJobAgeSeconds.set(
        { queue },
        counts.oldestWaitingAgeSeconds,
      );
    }
  }

  /** Fetches the finished job (still present until `removeOnComplete`/`removeOnFail` prunes it)
   *  to read `processedOn`/`finishedOn`/`attemptsMade` — none of which are in the terse
   *  `completed`/`failed` QueueEvents payload itself (verified against `bullmq`'s own
   *  `QueueEventsListener` type declarations). One extra Redis round trip per finished job, which
   *  is negligible at this application's job volumes. */
  private async recordJobFinished(
    queueName: string,
    jobId: string,
    outcome: 'completed' | 'failed',
  ): Promise<void> {
    if (!this.queueService) {
      return;
    }

    const job = await this.queueService.getJob(queueName, jobId);

    if (!job) {
      return;
    }

    if (
      typeof job.processedOn === 'number' &&
      typeof job.finishedOn === 'number'
    ) {
      this.bullmqJobDurationSeconds.observe(
        { queue: queueName, outcome },
        (job.finishedOn - job.processedOn) / 1000,
      );
    }

    if (typeof job.attemptsMade === 'number' && job.attemptsMade > 1) {
      this.bullmqJobRetriesTotal.inc(
        { queue: queueName },
        job.attemptsMade - 1,
      );
    }
  }

  observeHttpRequest(
    method: string,
    route: string,
    status: number,
    durationSeconds: number,
  ): void {
    const labels = { app: this.appName, method, route, status: String(status) };

    this.httpRequestsTotal.inc(labels);

    this.httpRequestDurationSeconds.observe(
      { app: this.appName, method, route },
      durationSeconds,
    );
  }

  incrementInFlightRequests(): void {
    this.httpRequestsInFlight.inc({ app: this.appName });
  }

  decrementInFlightRequests(): void {
    this.httpRequestsInFlight.dec({ app: this.appName });
  }

  recordJobFailed(queue: string): void {
    this.bullmqJobsFailedTotal.inc({ queue });
  }

  recordDispatchAssignmentAttempt(source: string): void {
    this.dispatchAssignmentAttemptsTotal.inc({ source });
  }

  observeDispatchAssignmentDuration(seconds: number): void {
    this.dispatchAssignmentDurationSeconds.observe(seconds);
  }

  recordDispatchRedispatch(reason: string): void {
    this.dispatchRedispatchTotal.inc({ reason });
  }

  recordDispatchReconciliationRun(ordersFound: number): void {
    this.dispatchReconciliationRunsTotal.inc();
    this.dispatchOrdersAwaitingAssignment.set(ordersFound);
  }

  /** Called once per cycle, at the moment the first partner of that cycle is offered. */
  recordDispatchCycleStarted(): void {
    this.dispatchCycleTotal.inc();
  }

  /** Called when a cycle's entire eligible-partner pool has been offered with no acceptance,
   *  immediately before scheduling the next cycle's delayed retry job. */
  recordDispatchCycleRetry(): void {
    this.dispatchCycleRetryTotal.inc();
  }

  /** Called by AssignmentExpiryProcessor when a PENDING assignment's 15s (configurable) window
   *  lapses unanswered and it successfully claims the PENDING to EXPIRED transition. */
  recordDispatchAssignmentTimeout(): void {
    this.dispatchAssignmentTimeoutTotal.inc();
  }

  /** Called by DispatchService.acceptAssignment() on a successful accept. */
  recordDispatchPartnerAccept(): void {
    this.dispatchPartnerAcceptTotal.inc();
    this.dispatchCompletedTotal.inc();
  }

  /** Called by DispatchService.rejectAssignment() on a successful reject. */
  recordDispatchPartnerReject(): void {
    this.dispatchPartnerRejectTotal.inc();
  }

  /** Called when an order's cycle count reaches DISPATCH_MAX_CYCLES with no acceptance — the
   *  terminal "give up automatically, fall back to reconciliation/manual assignment" case. */
  recordDispatchMaxCyclesReached(): void {
    this.dispatchMaxCyclesTotal.inc();
  }

  /** Called once per candidate found to still be within its rejection cooldown for an order,
   *  every time assignOrder() filters partners. */
  recordDispatchPartnerCooldown(): void {
    this.dispatchPartnerCooldownTotal.inc();
  }

  /** Called each time a cycle-exhausted retry is scheduled while DISPATCH_MAX_CYCLES=0. */
  recordDispatchUnlimitedCycle(): void {
    this.dispatchUnlimitedCycleTotal.inc();
  }

  /** Called only when round-robin rotation actually altered the starting candidate (cycle > 1
   *  and the rotation offset was non-zero) — not on every cycle regardless of effect. */
  recordDispatchCycleRotation(): void {
    this.dispatchCycleRotationTotal.inc();
  }

  /** Called once per successful acceptAssignment(), with that assignment's own
   *  respondedAt - assignedAt duration in seconds. */
  observeDispatchAssignmentAcceptanceLatency(seconds: number): void {
    this.dispatchAverageAssignmentSeconds.observe(seconds);
  }

  /** Called once per successful acceptAssignment(), with that assignment's own cycle number. */
  observeDispatchCyclesToAcceptance(cycle: number): void {
    this.dispatchAverageCycles.observe(cycle);
  }

  recordDispatchPartnerSkippedRateLimit(): void {
    this.dispatchPartnerSkippedRateLimitTotal.inc();
  }

  recordDispatchPartnerSkippedOffline(): void {
    this.dispatchPartnerSkippedOfflineTotal.inc();
  }

  recordDispatchPartnerSkippedActiveAssignment(): void {
    this.dispatchPartnerSkippedActiveAssignmentTotal.inc();
  }

  recordDispatchPartnerSkippedDistance(): void {
    this.dispatchPartnerSkippedDistanceTotal.inc();
  }

  recordOrderCreated(): void {
    this.ordersCreatedTotal.inc();
  }

  recordOrderCompleted(lifecycleDurationSeconds?: number): void {
    this.ordersCompletedTotal.inc();

    if (typeof lifecycleDurationSeconds === 'number') {
      this.orderLifecycleDurationSeconds.observe(
        { outcome: 'completed' },
        lifecycleDurationSeconds,
      );
    }
  }

  recordOrderCancelled(lifecycleDurationSeconds?: number): void {
    this.ordersCancelledTotal.inc();

    if (typeof lifecycleDurationSeconds === 'number') {
      this.orderLifecycleDurationSeconds.observe(
        { outcome: 'cancelled' },
        lifecycleDurationSeconds,
      );
    }
  }

  recordPaymentSuccess(latencySeconds?: number): void {
    this.paymentsSuccessTotal.inc();

    if (typeof latencySeconds === 'number') {
      this.paymentLatencySeconds.observe(
        { outcome: 'success' },
        latencySeconds,
      );
    }
  }

  recordPaymentFailed(latencySeconds?: number): void {
    this.paymentsFailedTotal.inc();

    if (typeof latencySeconds === 'number') {
      this.paymentLatencySeconds.observe({ outcome: 'failed' }, latencySeconds);
    }
  }

  recordPaymentRefunded(refundDurationSeconds?: number): void {
    this.paymentsRefundedTotal.inc();

    if (typeof refundDurationSeconds === 'number') {
      this.refundDurationSeconds.observe(refundDurationSeconds);
    }
  }

  recordSocketConnection(): void {
    this.socketioConnectionsTotal.inc();
    this.socketioConnectedClients.inc();
  }

  recordSocketDisconnection(): void {
    this.socketioDisconnectionsTotal.inc();
    this.socketioConnectedClients.dec();
  }

  recordSocketBroadcast(roomType: string): void {
    this.socketioBroadcastsTotal.inc({ room_type: roomType });
  }

  recordSocketEventEmitted(event: string): void {
    this.socketioEventsEmittedTotal.inc({ event });
  }

  observeStorageUploadDuration(seconds: number): void {
    this.storageUploadDurationSeconds.observe(seconds);
  }

  recordStorageUploadFailure(): void {
    this.storageUploadFailuresTotal.inc();
  }

  recordStorageDownloadFailure(): void {
    this.storageDownloadFailuresTotal.inc();
  }

  observePrismaQueryDuration(seconds: number): void {
    this.prismaQueryDurationSeconds.observe(seconds);
  }

  recordPrismaQueryError(): void {
    this.prismaQueryErrorsTotal.inc();
  }

  recordEventPublished(event: string): void {
    this.eventBusEventsPublishedTotal.inc({ event });
  }

  recordEventHandlerFailure(event: string): void {
    this.eventBusHandlerFailuresTotal.inc({ event });
  }

  recordPaymentReconciliationRun(pendingAfterSweep: number): void {
    this.paymentReconciliationRunsTotal.inc();
    this.paymentReconciliationPendingAfterSweep.set(pendingAfterSweep);
  }

  recordPaymentReconciliationError(): void {
    this.paymentReconciliationErrorsTotal.inc();
  }

  observeRazorpayApiCall(operation: string, seconds: number): void {
    this.razorpayApiCallDurationSeconds.observe({ operation }, seconds);
  }

  recordRazorpayApiCallFailure(operation: string): void {
    this.razorpayApiCallFailuresTotal.inc({ operation });
  }

  recordSupportAgentsOnline(count: number): void {
    this.supportAgentsOnline.set(count);
  }

  recordDeliveryPartnersOnline(count: number): void {
    this.deliveryPartnersOnline.set(count);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
