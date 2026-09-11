import { Job } from 'bullmq';

import { TicketEscalationProcessor } from './ticket-escalation.processor';

function buildJob(name: string): Job {
  return { name } as Job;
}

function lastPayload(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as unknown[][];
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('TicketEscalationProcessor', () => {
  let processor: TicketEscalationProcessor;
  let ticketsRepository: {
    findOverdueTickets: jest.Mock;
    markEscalated: jest.Mock;
  };
  let realtimeService: { emitToUser: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let auditService: { log: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    ticketsRepository = {
      findOverdueTickets: jest.fn(),
      markEscalated: jest.fn(),
    };
    realtimeService = { emitToUser: jest.fn() };
    notificationsService = { createNotification: jest.fn() };
    auditService = { log: jest.fn() };
    logger = { log: jest.fn(), error: jest.fn() };

    processor = new TicketEscalationProcessor(
      ticketsRepository as never,
      realtimeService as never,
      notificationsService as never,
      auditService as never,
      logger as never,
    );
  });

  it('emits scheduled_job_completed with resultCount = 0 when no ticket is overdue', async () => {
    ticketsRepository.findOverdueTickets.mockResolvedValue([]);

    await processor.process(buildJob('escalate-overdue-tickets'));

    expect(ticketsRepository.markEscalated).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_completed',
        job: 'ticket-escalation',
        queue: 'tickets',
        resultCount: 0,
      }),
      'TicketEscalationProcessor',
    );
    expect(typeof lastPayload(logger.log).durationMs).toBe('number');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('escalates every overdue ticket and only logs completion after every escalation finished', async () => {
    const ticket = {
      id: 'ticket-1',
      customerId: 'customer-1',
      ticketNumber: 'T-1',
      priority: 'MEDIUM',
    };
    ticketsRepository.findOverdueTickets.mockResolvedValue([ticket]);

    const callOrder: string[] = [];
    ticketsRepository.markEscalated.mockImplementation(() => {
      callOrder.push('markEscalated');
    });
    logger.log.mockImplementation(() => {
      callOrder.push('completed-log');
    });

    await processor.process(buildJob('escalate-overdue-tickets'));

    expect(ticketsRepository.markEscalated).toHaveBeenCalledWith('ticket-1');
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitToUser).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['markEscalated', 'completed-log']);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ resultCount: 1 }),
      'TicketEscalationProcessor',
    );
  });

  it('emits scheduled_job_failed (not completed) and rethrows when the repository lookup fails', async () => {
    const boom = new Error('support_tickets unavailable');
    ticketsRepository.findOverdueTickets.mockRejectedValue(boom);

    await expect(
      processor.process(buildJob('escalate-overdue-tickets')),
    ).rejects.toThrow('support_tickets unavailable');

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_failed',
        job: 'ticket-escalation',
        queue: 'tickets',
        reason: 'support_tickets unavailable',
      }),
      boom.stack,
      'TicketEscalationProcessor',
    );
    expect(typeof lastPayload(logger.error).durationMs).toBe('number');
  });
});
