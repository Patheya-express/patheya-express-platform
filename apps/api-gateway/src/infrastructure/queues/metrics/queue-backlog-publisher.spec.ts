import { Logger } from '@nestjs/common';
import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { Queue } from 'bullmq';
import {
  backlogOf,
  buildQueueMetricData,
  QUEUE_METRICS_NAMESPACE,
  QueueSnapshot,
} from './queue-backlog-metrics';
import {
  MetricsSink,
  QueueBacklogPublisher,
  QueueMetricsSettings,
  resolveQueueMetricsSettings,
} from './queue-backlog-publisher.service';

const NAMES = [
  'dispatch',
  'notifications',
  'payments',
  'search',
  'tickets',
  'orders',
];
const NOW = new Date('2026-10-11T12:00:00Z');

function snap(queue: string, over: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    queue,
    waiting: 0,
    prioritized: 0,
    active: 0,
    delayed: 0,
    oldestWaitingAgeSeconds: 0,
    ...over,
  };
}

function metric(
  data: ReturnType<typeof buildQueueMetricData>,
  name: string,
  queue?: string,
) {
  return data.find(
    (d) =>
      d.MetricName === name &&
      (queue === undefined
        ? d.Dimensions!.length === 1
        : d.Dimensions!.some((x) => x.Name === 'Queue' && x.Value === queue)),
  );
}

describe('buildQueueMetricData', () => {
  it('treats waiting + prioritized as backlog, and excludes active and delayed', () => {
    const data = buildQueueMetricData({
      environment: 'production',
      snapshots: [
        snap('dispatch', {
          waiting: 4,
          prioritized: 1,
          active: 8,
          delayed: 50,
        }),
        snap('orders', { waiting: 3, delayed: 900 }),
      ],
      workerCount: 2,
      timestamp: NOW,
    });
    expect(metric(data, 'Waiting', 'dispatch')!.Value).toBe(5);
    expect(metric(data, 'Active', 'dispatch')!.Value).toBe(8);
    expect(metric(data, 'Delayed', 'orders')!.Value).toBe(900);
    expect(metric(data, 'BacklogWaiting')!.Value).toBe(8);
    expect(metric(data, 'WorkerCount')!.Value).toBe(2);
    expect(metric(data, 'BacklogPerWorker')!.Value).toBe(4);
  });

  it('publishes zeros for empty queues (a measured zero, not a missing value)', () => {
    const data = buildQueueMetricData({
      environment: 'production',
      snapshots: NAMES.map((n) => snap(n)),
      workerCount: 1,
      timestamp: NOW,
    });
    // 6 queues x 3 + BacklogWaiting, OldestWaitingAgeSeconds, WorkerCount, BacklogPerWorker
    expect(data).toHaveLength(22);
    expect(metric(data, 'BacklogWaiting')!.Value).toBe(0);
    expect(metric(data, 'BacklogPerWorker')!.Value).toBe(0);
    expect(metric(data, 'OldestWaitingAgeSeconds')!.Value).toBe(0);
  });

  it.each([null, 0, -1, 1.5])(
    'omits the per-worker metrics when the worker count is %p',
    (workerCount) => {
      const data = buildQueueMetricData({
        environment: 'production',
        snapshots: [snap('dispatch', { waiting: 10 })],
        workerCount,
        timestamp: NOW,
      });
      expect(metric(data, 'BacklogPerWorker')).toBeUndefined();
      expect(metric(data, 'WorkerCount')).toBeUndefined();
      expect(metric(data, 'BacklogWaiting')!.Value).toBe(10);
    },
  );

  it('reports the oldest waiting age across queues', () => {
    const data = buildQueueMetricData({
      environment: 'production',
      snapshots: [
        snap('a', { oldestWaitingAgeSeconds: 12 }),
        snap('b', { oldestWaitingAgeSeconds: 340 }),
      ],
      workerCount: 1,
      timestamp: NOW,
    });
    expect(metric(data, 'OldestWaitingAgeSeconds')!.Value).toBe(340);
  });

  it('uses only bounded dimensions (Environment, Queue)', () => {
    const data = buildQueueMetricData({
      environment: 'production',
      snapshots: NAMES.map((n) => snap(n, { waiting: 1 })),
      workerCount: 1,
      timestamp: NOW,
    });
    const dimNames = new Set(
      data.flatMap((d) => d.Dimensions!.map((x) => x.Name)),
    );
    expect([...dimNames].sort()).toEqual(['Environment', 'Queue']);
  });

  it('never reports negative or non-finite counts', () => {
    expect(backlogOf(snap('q', { waiting: -3, prioritized: NaN }))).toBe(0);
  });
});

describe('resolveQueueMetricsSettings', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(resolveQueueMetricsSettings({}).enabled).toBe(false);
    expect(
      resolveQueueMetricsSettings({ QUEUE_METRICS_ENABLED: '1' }).enabled,
    ).toBe(false);
    expect(
      resolveQueueMetricsSettings({ QUEUE_METRICS_ENABLED: 'true' }).enabled,
    ).toBe(true);
  });

  it('defaults to a 60 s interval and rejects intervals under 10 s', () => {
    expect(resolveQueueMetricsSettings({}).intervalMs).toBe(60_000);
    expect(
      resolveQueueMetricsSettings({ QUEUE_METRICS_INTERVAL_MS: '500' })
        .intervalMs,
    ).toBe(60_000);
    expect(
      resolveQueueMetricsSettings({ QUEUE_METRICS_INTERVAL_MS: '30000' })
        .intervalMs,
    ).toBe(30_000);
  });

  it('takes the Environment dimension from QUEUE_METRICS_ENVIRONMENT, else NODE_ENV', () => {
    expect(
      resolveQueueMetricsSettings({ NODE_ENV: 'production' }).environment,
    ).toBe('production');
    expect(
      resolveQueueMetricsSettings({
        NODE_ENV: 'production',
        QUEUE_METRICS_ENVIRONMENT: 'prod-x',
      }).environment,
    ).toBe('prod-x');
  });
});

type FakeQueue = Queue & {
  fail: boolean;
  workersFail: boolean;
  calls: { counts: number };
};

function fakeQueue(
  name: string,
  counts: Partial<Record<string, number>> = {},
  workers = 1,
): FakeQueue {
  const state = { fail: false, workersFail: false, calls: { counts: 0 } };
  const methods = {
    name,
    getJobCounts: jest.fn(() => {
      state.calls.counts++;
      return state.fail
        ? Promise.reject(new Error('ECONNREFUSED redis'))
        : Promise.resolve({
            waiting: 0,
            prioritized: 0,
            active: 0,
            delayed: 0,
            ...counts,
          });
    }),
    getWaiting: jest.fn(() =>
      Promise.resolve(
        counts.waiting ? [{ timestamp: Date.now() - 30_000 }] : [],
      ),
    ),
    getWorkersCount: jest.fn(() =>
      state.workersFail
        ? Promise.reject(new Error('CLIENT LIST not permitted'))
        : Promise.resolve(workers),
    ),
  };
  return Object.assign(state, methods) as unknown as FakeQueue;
}

const SETTINGS: QueueMetricsSettings = {
  enabled: true,
  environment: 'production',
  intervalMs: 60_000,
  timeoutMs: 1_000,
};

function publisher(
  queues: FakeQueue[],
  sink: MetricsSink,
  settings = SETTINGS,
) {
  const [d, n, p, s, t, o] = queues;
  return new QueueBacklogPublisher(d, n, p, s, t, o, settings, sink);
}

function fakeSink() {
  const sent: PutMetricDataCommand[] = [];
  const sink = {
    fail: false,
    hang: false,
    destroy: jest.fn(),
    send: jest.fn(
      async (
        cmd: PutMetricDataCommand,
        opts?: { abortSignal?: AbortSignal },
      ) => {
        if (sink.hang) {
          await new Promise((_, reject) =>
            opts?.abortSignal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          );
        }
        if (sink.fail) throw new Error('ThrottlingException');
        sent.push(cmd);
        return {};
      },
    ),
  };
  return { sink, sent };
}

describe('QueueBacklogPublisher', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('publishes one PutMetricData per tick with the backlog and worker count', async () => {
    const queues = NAMES.map((n) =>
      fakeQueue(n, n === 'notifications' ? { waiting: 6 } : {}, 3),
    );
    const { sink, sent } = fakeSink();
    await publisher(queues, sink).tick();

    expect(sent).toHaveLength(1);
    const input = sent[0].input;
    expect(input.Namespace).toBe(QUEUE_METRICS_NAMESPACE);
    const backlog = input.MetricData!.find(
      (d) => d.MetricName === 'BacklogPerWorker',
    );
    expect(backlog!.Value).toBe(2);
    // Read-only: the fakes expose only getJobCounts/getWaiting/getWorkersCount, so any call that
    // adds, moves, retries or removes a job would throw and fail the publish above.
    for (const q of queues) expect(q.calls.counts).toBe(1);
  });

  it('publishes nothing when Redis cannot be read (missing, not zero)', async () => {
    const queues = NAMES.map((n) => fakeQueue(n));
    queues[2].fail = true;
    const { sink, sent } = fakeSink();
    await publisher(queues, sink).tick();
    expect(sent).toHaveLength(0);
    expect(sink.send).not.toHaveBeenCalled();
  });

  it('still publishes the backlog when only the worker count fails', async () => {
    const queues = NAMES.map((n) => fakeQueue(n, { waiting: 1 }));
    queues[0].workersFail = true;
    const { sink, sent } = fakeSink();
    await publisher(queues, sink).tick();
    const names = sent[0].input.MetricData!.map((d) => d.MetricName);
    expect(names).toContain('BacklogWaiting');
    expect(names).not.toContain('BacklogPerWorker');
  });

  it('survives a CloudWatch failure and publishes on the next tick', async () => {
    const queues = NAMES.map((n) => fakeQueue(n));
    const { sink, sent } = fakeSink();
    const pub = publisher(queues, sink);
    sink.fail = true;
    await expect(pub.tick()).resolves.toBeUndefined();
    sink.fail = false;
    await pub.tick();
    expect(sent).toHaveLength(1);
  });

  it('never overlaps publishes and times out a hung CloudWatch call', async () => {
    const queues = NAMES.map((n) => fakeQueue(n));
    const { sink } = fakeSink();
    sink.hang = true;
    const pub = publisher(queues, sink, { ...SETTINGS, timeoutMs: 50 });
    const first = pub.tick();
    expect(pub.tick()).toBeUndefined();
    await first;
    expect(sink.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    jest.useFakeTimers();
    try {
      const queues = NAMES.map((n) => fakeQueue(n));
      const { sink } = fakeSink();
      const pub = publisher(queues, sink, { ...SETTINGS, enabled: false });
      pub.onApplicationBootstrap();
      jest.advanceTimersByTime(300_000);
      expect(sink.send).not.toHaveBeenCalled();
      expect(queues[0].calls.counts).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops the interval on shutdown, waits for the in-flight publish, and releases the client', async () => {
    const queues = NAMES.map((n) => fakeQueue(n));
    const { sink, sent } = fakeSink();
    const pub = publisher(queues, sink);
    pub.onApplicationBootstrap(); // first tick starts immediately
    await pub.onApplicationShutdown();
    expect(sent).toHaveLength(1);
    expect(sink.destroy).toHaveBeenCalled();
    expect(
      (pub as unknown as { handle?: NodeJS.Timeout }).handle,
    ).toBeUndefined();
  });
});
