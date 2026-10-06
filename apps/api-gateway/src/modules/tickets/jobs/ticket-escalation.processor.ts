import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { NotificationType } from '@prisma/client';

import { TicketsRepository } from '../repositories/tickets.repository';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

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
    // Phase 3F-3 (Scheduled Job Observability): previously no logger of any kind existed in this
    // class — this is the same structured logger AssignmentExpiryProcessor/NotificationProcessor
    // already use for job-lifecycle events, used here only for scheduled_job_completed/failed.
    private readonly logger: AppLoggerService,
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
    const startedAt = Date.now();

    try {
      const threshold = new Date(
        Date.now() - SLA_THRESHOLD_HOURS * 60 * 60 * 1000,
      );
      const overdue =
        await this.ticketsRepository.findOverdueTickets(threshold);

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

      // Phase 3F-3 (Scheduled Job Observability): the class previously had no logger at all — a
      // fully successful run (including the common zero-overdue-tickets case) left zero trace.
      this.logger.log(
        {
          event: 'scheduled_job_completed',
          job: 'ticket-escalation',
          queue: 'tickets',
          durationMs: Date.now() - startedAt,
          resultCount: overdue.length,
        },
        'TicketEscalationProcessor',
      );
    } catch (error) {
      // Rethrown unchanged below — preserves BullMQ's existing retry/failure behavior exactly;
      // this only adds a job-scoped, duration-carrying, immediately-searchable failure record.
      this.logger.error(
        {
          event: 'scheduled_job_failed',
          job: 'ticket-escalation',
          queue: 'tickets',
          durationMs: Date.now() - startedAt,
          reason: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        'TicketEscalationProcessor',
      );

      throw error;
    }
  }
}
