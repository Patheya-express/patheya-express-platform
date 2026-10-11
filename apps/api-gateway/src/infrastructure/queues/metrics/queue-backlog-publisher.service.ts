import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import type { Queue } from 'bullmq';
import {
  buildQueueMetricData,
  QUEUE_METRICS_NAMESPACE,
  QueueSnapshot,
} from './queue-backlog-metrics';

/** Minimal client surface, so tests can substitute a fake. */
export interface MetricsSink {
  send(
    command: PutMetricDataCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
  destroy?(): void;
}

export const QUEUE_METRICS_SINK = Symbol('QUEUE_METRICS_SINK');
export const QUEUE_METRICS_SETTINGS = Symbol('QUEUE_METRICS_SETTINGS');

export interface QueueMetricsSettings {
  enabled: boolean;
  environment: string;
  intervalMs: number;
  /** Per-publish budget for Redis reads plus the CloudWatch call. */
  timeoutMs: number;
}

const MIN_INTERVAL_MS = 10_000;

/**
 * QUEUE_METRICS_ENABLED=true turns publishing on (set only on the ECS worker task by Terraform;
 * off locally, in tests and in the API process). QUEUE_METRICS_ENVIRONMENT is the Environment
 * dimension (default: NODE_ENV). QUEUE_METRICS_INTERVAL_MS defaults to 60 s, CloudWatch's
 * standard resolution.
 */
export function resolveQueueMetricsSettings(
  env: NodeJS.ProcessEnv = process.env,
): QueueMetricsSettings {
  const interval = Number(env.QUEUE_METRICS_INTERVAL_MS);
  const intervalMs =
    Number.isInteger(interval) && interval >= MIN_INTERVAL_MS
      ? interval
      : 60_000;
  return {
    enabled: env.QUEUE_METRICS_ENABLED === 'true',
    environment: (
      env.QUEUE_METRICS_ENVIRONMENT ||
      env.NODE_ENV ||
      'development'
    ).trim(),
    intervalMs,
    timeoutMs: Math.min(15_000, Math.floor(intervalMs / 2)),
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} timed out after ${ms} ms`)),
        ms,
      );
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Publishes BullMQ backlog to CloudWatch once a minute from each worker task (identical values
 * from every task; scaling and alarms use the Maximum statistic). Read-only against the queues:
 * it never adds, moves, retries or removes jobs.
 *
 * Failure handling: if Redis cannot be read, nothing is published for that interval (a missing
 * datapoint, never a fabricated 0); a CloudWatch failure is logged and the next interval tries
 * again. Publishes never overlap, and shutdown waits for an in-flight publish within its timeout.
 */
@Injectable()
export class QueueBacklogPublisher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(QueueBacklogPublisher.name);
  private readonly queues: Queue[];
  /** Queues whose processors always run in the worker — used to count worker processes. */
  private readonly workerCountQueues: Queue[];
  private handle?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private sink?: MetricsSink;
  private readonly settings: QueueMetricsSettings;

  constructor(
    @InjectQueue('dispatch') dispatch: Queue,
    @InjectQueue('notifications') notifications: Queue,
    @InjectQueue('payments') payments: Queue,
    @InjectQueue('search') search: Queue,
    @InjectQueue('tickets') tickets: Queue,
    @InjectQueue('orders') orders: Queue,
    @Optional() @Inject(QUEUE_METRICS_SETTINGS) settings?: QueueMetricsSettings,
    @Optional() @Inject(QUEUE_METRICS_SINK) sink?: MetricsSink,
  ) {
    this.queues = [dispatch, notifications, payments, search, tickets, orders];
    this.workerCountQueues = [dispatch, notifications, orders];
    this.settings = settings ?? resolveQueueMetricsSettings();
    this.sink = sink;
  }

  onApplicationBootstrap(): void {
    if (!this.settings.enabled) {
      this.logger.log(
        'Queue backlog metrics disabled (QUEUE_METRICS_ENABLED != true)',
      );
      return;
    }
    this.sink ??= new CloudWatchClient({ maxAttempts: 2 });
    this.logger.log(
      `Publishing queue backlog to CloudWatch ${QUEUE_METRICS_NAMESPACE} every ${this.settings.intervalMs} ms (Environment=${this.settings.environment})`,
    );
    this.handle = setInterval(() => void this.tick(), this.settings.intervalMs);
    this.handle.unref();
    void this.tick();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.handle) clearInterval(this.handle);
    this.handle = undefined;
    if (this.inFlight) {
      await withTimeout(
        this.inFlight,
        this.settings.timeoutMs,
        'final queue metrics publish',
      ).catch(() => undefined);
    }
    this.sink?.destroy?.();
  }

  /** One publish at a time; a tick that finds one still running is skipped. */
  tick(): Promise<void> | undefined {
    if (this.inFlight) return undefined;
    this.inFlight = this.publishOnce()
      .catch((error: unknown) => {
        this.logger.warn(
          `Queue backlog metrics not published: ${String(error)}`,
        );
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  async collect(): Promise<{
    snapshots: QueueSnapshot[];
    workerCount: number | null;
  }> {
    const snapshots = await Promise.all(
      this.queues.map(async (queue) => {
        const [counts, oldest] = await Promise.all([
          queue.getJobCounts('waiting', 'prioritized', 'active', 'delayed'),
          queue.getWaiting(0, 0),
        ]);
        return {
          queue: queue.name,
          waiting: counts.waiting ?? 0,
          prioritized: counts.prioritized ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          oldestWaitingAgeSeconds:
            oldest.length > 0
              ? Math.max(0, (Date.now() - oldest[0].timestamp) / 1000)
              : 0,
        };
      }),
    );

    let workerCount: number | null = null;
    try {
      const counts = await Promise.all(
        this.workerCountQueues.map((q) => q.getWorkersCount()),
      );
      workerCount = Math.max(...counts);
    } catch (error: unknown) {
      this.logger.warn(
        `Worker count unavailable, BacklogPerWorker omitted: ${String(error)}`,
      );
    }
    return { snapshots, workerCount };
  }

  private async publishOnce(): Promise<void> {
    const timeout = AbortSignal.timeout(this.settings.timeoutMs);
    // A failure here throws before anything is sent: no datapoint rather than a guessed one.
    const { snapshots, workerCount } = await withTimeout(
      this.collect(),
      this.settings.timeoutMs,
      'queue count read',
    );
    const metricData = buildQueueMetricData({
      environment: this.settings.environment,
      snapshots,
      workerCount,
      timestamp: new Date(),
    });
    await this.sink!.send(
      new PutMetricDataCommand({
        Namespace: QUEUE_METRICS_NAMESPACE,
        MetricData: metricData,
      }),
      { abortSignal: timeout },
    );
  }
}
