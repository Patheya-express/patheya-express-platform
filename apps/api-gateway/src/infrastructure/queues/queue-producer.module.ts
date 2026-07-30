import { Global, Module } from '@nestjs/common';

import { BullModule } from '@nestjs/bullmq';

import { QueueInfrastructureModule } from './queue-infrastructure.module';

import { QueueService } from './queue.service';

import { BullmqSharedConnectionObserver } from './bullmq-shared-connection-observer.service';
import { RedisInfrastructureModule } from '../redis-infrastructure/redis-infrastructure.module';

/**
 * Production Readiness Stage A (BullMQ Reliability audit): before this, no queue anywhere in
 * this codebase set `attempts`/`backoff`/`removeOnComplete`/`removeOnFail` — every `.add()` call
 * in `queue.service.ts` only ever sets `delay`/`jobId`. BullMQ's own default for an unset
 * `attempts` is `0` (`classes/job.js`: `Object.assign({ attempts: 0 }, opts)`), and its retry
 * check is `attemptsMade + 1 < opts.attempts` — for `attempts: 0` that's `1 < 0`, always false,
 * so a job failed on its *first* attempt goes straight to `failed` with zero automatic retry.
 * Combined with no `removeOnComplete`/`removeOnFail`, completed/failed jobs were also never
 * pruned, growing Redis memory unboundedly over the app's lifetime.
 *
 * `defaultJobOptions` here is a per-queue *fallback* — verified against BullMQ's own merge order
 * (`classes/queue.js`: `Object.assign({}, this.jobsOpts, opts, ...)`, and the same shape for
 * `upsertJobScheduler`): any per-call option `queue.service.ts` already sets (`delay`, `jobId`)
 * still wins; only the keys nothing else sets are filled in here. No existing `.add()`/
 * `upsertJobScheduler()` call needed to change.
 *
 * `backoff`'s `{type: 'exponential', delay: 2000}` matches this platform's own already-documented
 * convention (`redis-connection.config.ts`'s comment: "exponential backoff, base 2 seconds",
 * platform-standards.md Section 17) — applied here to job retries, the one place that convention
 * wasn't yet reaching. `removeOnComplete`/`removeOnFail` use bounded counts (not `true`, which
 * deletes immediately and destroys failure-investigation history; not unset, which never prunes)
 * so Redis memory stays bounded while still keeping enough recent history to investigate.
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

// Registered once here — the same 6 names `QueueService` injects and the same 6 names
// `QueueWorkerModule`'s processors handle. Kept as a module-level constant (rather than inlined
// in `imports`) so the identical dynamic module reference can also be re-exported below.
const registeredQueues = BullModule.registerQueue(
  { name: 'notifications', defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: 'dispatch', defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: 'payments', defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: 'search', defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: 'tickets', defaultJobOptions: DEFAULT_JOB_OPTIONS },
  { name: 'orders', defaultJobOptions: DEFAULT_JOB_OPTIONS },
);

/**
 * Producer-only half of the former `QueuesModule` split. Provides the 6 `Queue` clients and
 * `QueueService` — everything `@InjectQueue`/`QueueService.add*Job` callers need to enqueue
 * work — and deliberately declares zero `@Processor`s, so importing this module alone never
 * creates a BullMQ `Worker`.
 *
 * `@Global()` preserves pre-refactor behavior: every business module that already injects
 * `QueueService` without importing `QueuesModule` itself (`OrdersService`, `DispatchService`,
 * `PaymentsService`, `NotificationsService`, `AdminDispatchService`, `SystemController`'s module,
 * etc.) keeps working unchanged.
 */
@Global()
@Module({
  imports: [QueueInfrastructureModule, registeredQueues, RedisInfrastructureModule],

  providers: [QueueService, BullmqSharedConnectionObserver],

  exports: [registeredQueues, QueueService],
})
export class QueueProducerModule {}
