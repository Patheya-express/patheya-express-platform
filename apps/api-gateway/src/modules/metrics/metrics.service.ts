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
    // RedisInfrastructureModule is @Global() and imported by both AppModule and WorkerModule, so
    // these are always available — not marked @Optional().
    private readonly redisConnectionFactory: RedisConnectionFactory,
    private readonly redisConfiguration: RedisConfigurationService,
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

        this.logger.warn(
          `Job ${jobId} on queue "${queueName}" failed: ${failedReason}`,
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
          this.redisConnectionFactory.registerExternalConnection(client as unknown as Redis, {
            name: `bullmq:queue-events:${queueName}`,
            type: RedisConnectionType.BULLMQ_QUEUE_EVENTS,
            owner: 'MetricsService',
            purpose: 'BullMQ QueueEvents monitoring',
          });
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
