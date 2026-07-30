import { Global, Module } from '@nestjs/common';

import { BullModule } from '@nestjs/bullmq';

import { QueueInfrastructureModule } from './queue-infrastructure.module';

import { QueueService } from './queue.service';

import { BullmqSharedConnectionObserver } from './bullmq-shared-connection-observer.service';
import { RedisInfrastructureModule } from '../redis-infrastructure/redis-infrastructure.module';

// Registered once here — the same 6 names `QueueService` injects and the same 6 names
// `QueueWorkerModule`'s processors handle. Kept as a module-level constant (rather than inlined
// in `imports`) so the identical dynamic module reference can also be re-exported below.
const registeredQueues = BullModule.registerQueue(
  { name: 'notifications' },
  { name: 'dispatch' },
  { name: 'payments' },
  { name: 'search' },
  { name: 'tickets' },
  { name: 'orders' },
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
