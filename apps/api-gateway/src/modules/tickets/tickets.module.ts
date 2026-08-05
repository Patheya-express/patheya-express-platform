import { Module } from '@nestjs/common';

import { TicketsController } from './controllers/tickets.controller';
import { FaqController } from './controllers/faq.controller';

import { TicketsService } from './services/tickets.service';
import { FaqService } from './services/faq.service';

import { FaqRepository } from './repositories/faq.repository';

import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { TicketsCoreModule } from './tickets-core.module';

/**
 * HTTP-facing half of the tickets feature — controllers + `TicketsService`/`FaqService`.
 * `TicketsRepository` lives in `TicketsCoreModule`, shared with `TicketsWorkerModule` rather than
 * duplicated. `TicketEscalationProcessor`/`TicketEscalationBootstrap` moved to
 * `TicketsWorkerModule` (imported only by the worker process) so this module no longer
 * instantiates a BullMQ Worker.
 */
@Module({
  imports: [NotificationsModule, AuditModule, TicketsCoreModule],

  controllers: [TicketsController, FaqController],

  providers: [TicketsService, FaqService, FaqRepository],

  exports: [TicketsService],
})
export class TicketsModule {}
