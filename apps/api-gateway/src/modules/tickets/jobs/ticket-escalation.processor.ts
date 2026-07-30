import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { NotificationType } from '@prisma/client';

import { TicketsRepository } from '../repositories/tickets.repository';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';

import { AuditAction } from '@prisma/client';

/** Tickets left OPEN/IN_PROGRESS this long without resolution are auto-escalated to URGENT. */
const SLA_THRESHOLD_HOURS = 24;

@Processor('tickets')
export class TicketEscalationProcessor extends WorkerHost {
  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'escalate-overdue-tickets':
        await this.escalateOverdueTickets();

        break;
    }
  }

  private async escalateOverdueTickets(): Promise<void> {
    const threshold = new Date(
      Date.now() - SLA_THRESHOLD_HOURS * 60 * 60 * 1000,
    );
    const overdue = await this.ticketsRepository.findOverdueTickets(threshold);

    for (const ticket of overdue) {
      await this.ticketsRepository.markEscalated(ticket.id);

      await this.auditService.log(
        null,
        'SupportTicket',
        ticket.id,
        AuditAction.STATUS_CHANGE,
        { priority: ticket.priority },
        { priority: 'URGENT', escalated: true },
      );

      this.realtimeService.emitToUser(
        ticket.customerId,
        'ticket.status.changed',
        {
          ticketId: ticket.id,
          escalated: true,
        },
      );

      await this.notificationsService.createNotification(
        ticket.customerId,
        NotificationType.TICKET_STATUS_CHANGED,
        'Your support ticket has been escalated',
        `Ticket ${ticket.ticketNumber} has been escalated to our senior support team.`,
        { referenceType: 'TICKET', referenceId: ticket.id },
      );
    }
  }
}
