import { DispatchReconciliationService } from './dispatch-reconciliation.service';

function lastPayload(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as unknown[][];
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('DispatchReconciliationService', () => {
  let service: DispatchReconciliationService;
  let dispatchRepository: { findStrandedReadyForPickupOrders: jest.Mock };
  let queueService: { addDispatchAssignmentJob: jest.Mock };
  let metrics: { recordDispatchReconciliationRun: jest.Mock };
  let appLogger: { log: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    dispatchRepository = { findStrandedReadyForPickupOrders: jest.fn() };
    queueService = { addDispatchAssignmentJob: jest.fn() };
    metrics = { recordDispatchReconciliationRun: jest.fn() };
    appLogger = { log: jest.fn(), error: jest.fn() };

    service = new DispatchReconciliationService(
      dispatchRepository as never,
      queueService as never,
      metrics as never,
      appLogger as never,
    );
  });

  it('emits scheduled_job_completed with resultCount = 0 when nothing is stranded, without re-enqueuing anything', async () => {
    dispatchRepository.findStrandedReadyForPickupOrders.mockResolvedValue([]);

    await service.reconcileStrandedAssignments();

    expect(queueService.addDispatchAssignmentJob).not.toHaveBeenCalled();
    expect(appLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_completed',
        job: 'dispatch-reconciliation',
        queue: 'dispatch',
        resultCount: 0,
      }),
      'DispatchReconciliationService',
    );
    expect(typeof lastPayload(appLogger.log).durationMs).toBe('number');
    expect(appLogger.error).not.toHaveBeenCalled();
  });

  it('re-enqueues every stranded order and emits scheduled_job_completed with the real resultCount only after enqueuing finishes', async () => {
    const orders = [{ id: 'order-1' }, { id: 'order-2' }];
    dispatchRepository.findStrandedReadyForPickupOrders.mockResolvedValue(
      orders,
    );

    const callOrder: string[] = [];
    queueService.addDispatchAssignmentJob.mockImplementation(() => {
      callOrder.push('enqueue');
    });
    appLogger.log.mockImplementation(() => {
      callOrder.push('completed-log');
    });

    await service.reconcileStrandedAssignments();

    expect(queueService.addDispatchAssignmentJob).toHaveBeenCalledTimes(2);
    expect(queueService.addDispatchAssignmentJob).toHaveBeenCalledWith(
      'order-1',
      'reconciliation',
    );
    expect(queueService.addDispatchAssignmentJob).toHaveBeenCalledWith(
      'order-2',
      'reconciliation',
    );

    // Completion is logged strictly after every enqueue — not before the business operation
    // actually finished.
    expect(callOrder).toEqual(['enqueue', 'enqueue', 'completed-log']);

    expect(appLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ resultCount: 2 }),
      'DispatchReconciliationService',
    );
  });

  it('emits scheduled_job_failed (not scheduled_job_completed) and rethrows when the repository lookup fails', async () => {
    const boom = new Error('connection reset');
    dispatchRepository.findStrandedReadyForPickupOrders.mockRejectedValue(boom);

    await expect(service.reconcileStrandedAssignments()).rejects.toThrow(
      'connection reset',
    );

    expect(appLogger.log).not.toHaveBeenCalled();
    expect(appLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_failed',
        job: 'dispatch-reconciliation',
        queue: 'dispatch',
        reason: 'connection reset',
      }),
      boom.stack,
      'DispatchReconciliationService',
    );
    expect(typeof lastPayload(appLogger.error).durationMs).toBe('number');
  });
});
