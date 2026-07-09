import { Module } from '@nestjs/common';

import { TicketsController } from './controllers/tickets.controller';
import { FaqController } from './controllers/faq.controller';

import { TicketsService } from './services/tickets.service';
import { FaqService } from './services/faq.service';

import { TicketsRepository } from './repositories/tickets.repository';
import { FaqRepository } from './repositories/faq.repository';

import { TicketEscalationProcessor } from './jobs/ticket-escalation.processor';
import { TicketEscalationBootstrap } from './jobs/ticket-escalation.bootstrap';

import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [NotificationsModule, AuditModule],

  controllers: [TicketsController, FaqController],

  providers: [
    TicketsService,
    FaqService,
    TicketsRepository,
    FaqRepository,
    TicketEscalationProcessor,
    TicketEscalationBootstrap,
  ],

  exports: [TicketsService],
})
export class TicketsModule {}
