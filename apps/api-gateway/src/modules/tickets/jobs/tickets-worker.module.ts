import { Module } from '@nestjs/common';

import { TicketEscalationProcessor } from './ticket-escalation.processor';
import { TicketEscalationBootstrap } from './ticket-escalation.bootstrap';

import { TicketsCoreModule } from '../tickets-core.module';
import { NotificationsCoreModule } from '../../notifications/notifications-core.module';
import { AuditCoreModule } from '../../audit/audit-core.module';

/**
 * Worker-only half of the tickets feature. Imported solely by `QueueWorkerModule` (never by
 * `AppModule`), so `TicketEscalationProcessor` and its repeatable-job bootstrap only run in the
 * dedicated worker process. Depends on `TicketsCoreModule` for `TicketsRepository` rather than
 * duplicating it; `NotificationsCoreModule`/`AuditCoreModule` (controller-free) provide
 * `NotificationsService`/`AuditService`, the same dependencies the processor already needed.
 */
@Module({
  imports: [TicketsCoreModule, NotificationsCoreModule, AuditCoreModule],

  providers: [TicketEscalationProcessor, TicketEscalationBootstrap],
})
export class TicketsWorkerModule {}
