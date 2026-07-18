import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';

import { QueueEvents } from 'bullmq';

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

import { getRedisConnectionOptions } from '../../infrastructure/redis/redis-connection.config';

import { QueueService } from '../../infrastructure/queues/queue.service';

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
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);

  private readonly registry = new Registry();

  private readonly appName = process.env.APP_NAME || 'api-gateway';

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

  private pollHandle?: ReturnType<typeof setInterval>;

  private readonly queueEventListeners: QueueEvents[] = [];

  constructor(
    // Optional: worker-main.ts's WorkerModule does import QueuesModule (it needs the processors),
    // so QueueService is actually always available today — kept optional defensively, since a
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
      const events = new QueueEvents(queueName, {
        connection: getRedisConnectionOptions(),
      });

      events.on('failed', ({ jobId, failedReason }) => {
        this.recordJobFailed(queueName);

        this.logger.warn(
          `Job ${jobId} on queue "${queueName}" failed: ${failedReason}`,
        );
      });

      this.queueEventListeners.push(events);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
    }

    await Promise.all(this.queueEventListeners.map((events) => events.close()));
  }

  private async pollQueueDepths(): Promise<void> {
    const depths = await this.queueService!.getQueueDepths();

    for (const [queue, depth] of Object.entries(depths)) {
      this.bullmqQueueDepth.set({ queue }, depth);
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

  recordJobFailed(queue: string): void {
    this.bullmqJobsFailedTotal.inc({ queue });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
