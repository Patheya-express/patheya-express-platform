import type { MetricDatum } from '@aws-sdk/client-cloudwatch';

/**
 * Queue backlog metrics published to CloudWatch for ECS worker autoscaling and alarms.
 *
 * Bounded dimensions only: `Environment` (one value per deployment) and `Queue` (the six fixed
 * BullMQ queue names). Never job IDs, customer IDs, or anything else that grows with traffic.
 *
 * States, as BullMQ 5 counts them:
 *   waiting + prioritized — accepted work no worker has picked up yet: the backlog. Adding worker
 *                           tasks drains it, so it is what scaling follows.
 *   active                — being processed now; reported, never scaled on (it is bounded by
 *                           processor concurrency, so it saturates instead of growing).
 *   delayed               — scheduled for later by design (e.g. order acceptance timeouts);
 *                           reported, never scaled on — more workers cannot run them sooner.
 */
export const QUEUE_METRICS_NAMESPACE = 'Patheya/Queues';

export interface QueueSnapshot {
  queue: string;
  waiting: number;
  prioritized: number;
  active: number;
  delayed: number;
  /** Age of the oldest waiting job, 0 when nothing is waiting. */
  oldestWaitingAgeSeconds: number;
}

export interface QueueMetricsInput {
  environment: string;
  snapshots: QueueSnapshot[];
  /**
   * Worker processes connected to the queues (BullMQ getWorkersCount). null when it could not be
   * read; then BacklogPerWorker is omitted rather than guessed.
   */
  workerCount: number | null;
  timestamp: Date;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function backlogOf(snapshot: QueueSnapshot): number {
  return nonNegative(snapshot.waiting) + nonNegative(snapshot.prioritized);
}

export function buildQueueMetricData(input: QueueMetricsInput): MetricDatum[] {
  const { environment, snapshots, workerCount, timestamp } = input;
  const env = { Name: 'Environment', Value: environment };
  const data: MetricDatum[] = [];

  for (const s of snapshots) {
    const dims = [env, { Name: 'Queue', Value: s.queue }];
    data.push(
      {
        MetricName: 'Waiting',
        Dimensions: dims,
        Value: backlogOf(s),
        Unit: 'Count',
        Timestamp: timestamp,
      },
      {
        MetricName: 'Active',
        Dimensions: dims,
        Value: nonNegative(s.active),
        Unit: 'Count',
        Timestamp: timestamp,
      },
      {
        MetricName: 'Delayed',
        Dimensions: dims,
        Value: nonNegative(s.delayed),
        Unit: 'Count',
        Timestamp: timestamp,
      },
    );
  }

  const backlog = snapshots.reduce((sum, s) => sum + backlogOf(s), 0);
  const oldest = snapshots.reduce(
    (max, s) => Math.max(max, nonNegative(s.oldestWaitingAgeSeconds)),
    0,
  );

  data.push(
    {
      MetricName: 'BacklogWaiting',
      Dimensions: [env],
      Value: backlog,
      Unit: 'Count',
      Timestamp: timestamp,
    },
    {
      MetricName: 'OldestWaitingAgeSeconds',
      Dimensions: [env],
      Value: oldest,
      Unit: 'Seconds',
      Timestamp: timestamp,
    },
  );

  // The process publishing this is itself a worker, so a healthy count is >= 1; 0 or unknown
  // means the count is unreliable, and a scaling metric is better missing than wrong.
  if (
    workerCount !== null &&
    Number.isInteger(workerCount) &&
    workerCount >= 1
  ) {
    data.push(
      {
        MetricName: 'WorkerCount',
        Dimensions: [env],
        Value: workerCount,
        Unit: 'Count',
        Timestamp: timestamp,
      },
      {
        MetricName: 'BacklogPerWorker',
        Dimensions: [env],
        Value: backlog / workerCount,
        Unit: 'Count',
        Timestamp: timestamp,
      },
    );
  }

  return data;
}
