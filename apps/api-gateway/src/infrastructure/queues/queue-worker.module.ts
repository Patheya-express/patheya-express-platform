import { Module } from '@nestjs/common';

import { QueueInfrastructureModule } from './queue-infrastructure.module';

import { QueueProducerModule } from './queue-producer.module';

import { NotificationProcessor } from './processors/notification.processor';
import { AssignmentExpiryProcessor } from './processors/assignment-expiry.processor';
import { OrderAcceptanceTimeoutProcessor } from './processors/order-acceptance-timeout.processor';

import { DispatchCoreModule } from '../../modules/dispatch/dispatch-core.module';
import { NotificationsCoreModule } from '../../modules/notifications/notifications-core.module';
import { OrdersCoreModule } from '../../modules/orders/orders-core.module';
import { AuditCoreModule } from '../../modules/audit/audit-core.module';
import { PaymentsWorkerModule } from '../../modules/payments/jobs/payments-worker.module';
import { SearchWorkerModule } from '../../modules/search/jobs/search-worker.module';
import { TicketsWorkerModule } from '../../modules/tickets/jobs/tickets-worker.module';

/**
 * Single owner of every BullMQ processor in the system. Imported only by `WorkerModule` — never
 * by `AppModule` — so all 6 Workers (and the blocking Redis connections BullMQ opens for them)
 * only run in the dedicated worker process, not in any API replica.
 *
 * Every import here is a controller-free `*CoreModule` (`DispatchCoreModule`/
 * `NotificationsCoreModule`/`OrdersCoreModule`/`AuditCoreModule`, plus the `*WorkerModule`s which
 * themselves only depend on Core modules transitively) — none of them carry an HTTP controller,
 * which is what stops the Worker process from instantiating any of the application's controllers
 * (`OrdersController`, `DispatchController`, `DeliveryController` and its dozen siblings,
 * `RestaurantsController` and its dozen siblings, `AuthController`, `UsersController`,
 * `PresenceController`, etc. — all reachable transitively from `OrdersCoreModule`/
 * `DispatchCoreModule` before this split, none of them anymore).
 */
@Module({
  imports: [
    QueueInfrastructureModule,
    QueueProducerModule,
    DispatchCoreModule,
    NotificationsCoreModule,
    OrdersCoreModule,
    AuditCoreModule,
    PaymentsWorkerModule,
    SearchWorkerModule,
    TicketsWorkerModule,
  ],

  providers: [
    NotificationProcessor,
    AssignmentExpiryProcessor,
    OrderAcceptanceTimeoutProcessor,
  ],
})
export class QueueWorkerModule {}
