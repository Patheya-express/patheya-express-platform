import { PaymentReconciliationService } from './payment-reconciliation.service';

function lastPayload(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as unknown[][];
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('PaymentReconciliationService', () => {
  let service: PaymentReconciliationService;
  let paymentsRepository: { findPendingPayments: jest.Mock };
  let paymentProvider: { fetchOrderPayments: jest.Mock };
  let paymentsService: { markPaymentSucceededFromReconciliation: jest.Mock };
  let metrics: {
    recordPaymentReconciliationRun: jest.Mock;
    recordPaymentReconciliationError: jest.Mock;
  };
  let appLogger: { log: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    paymentsRepository = { findPendingPayments: jest.fn() };
    paymentProvider = { fetchOrderPayments: jest.fn() };
    paymentsService = {
      markPaymentSucceededFromReconciliation: jest.fn(),
    };
    metrics = {
      recordPaymentReconciliationRun: jest.fn(),
      recordPaymentReconciliationError: jest.fn(),
    };
    appLogger = { log: jest.fn(), error: jest.fn() };

    service = new PaymentReconciliationService(
      paymentsRepository as never,
      paymentProvider as never,
      paymentsService as never,
      metrics as never,
      appLogger as never,
    );
  });

  it('emits scheduled_job_completed with resultCount/resolvedCount when every pending payment resolves', async () => {
    paymentsRepository.findPendingPayments.mockResolvedValue([
      { id: 'pay-1', providerOrderId: 'order-1' },
    ]);
    paymentProvider.fetchOrderPayments.mockResolvedValue({
      items: [{ id: 'razorpay-1', status: 'captured' }],
    });
    paymentsService.markPaymentSucceededFromReconciliation.mockResolvedValue(
      undefined,
    );

    await service.reconcilePendingPayments();

    expect(metrics.recordPaymentReconciliationRun).toHaveBeenCalledWith(0);
    expect(appLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_completed',
        job: 'payment-reconciliation',
        queue: 'payments',
        resultCount: 1,
        resolvedCount: 1,
      }),
      'PaymentReconciliationService',
    );
    expect(typeof lastPayload(appLogger.log).durationMs).toBe('number');
    expect(appLogger.error).not.toHaveBeenCalled();
  });

  it('still emits scheduled_job_completed (not failed) when every payment in the sweep fails to reconcile — a per-payment error is not a job failure by existing design', async () => {
    paymentsRepository.findPendingPayments.mockResolvedValue([
      { id: 'pay-1', providerOrderId: 'order-1' },
    ]);
    paymentProvider.fetchOrderPayments.mockRejectedValue(
      new Error('razorpay unreachable'),
    );

    await service.reconcilePendingPayments();

    expect(metrics.recordPaymentReconciliationError).toHaveBeenCalledTimes(1);
    // pendingAfterSweep = 1 (swept 1, resolved 0) — the existing per-payment-failure signal.
    expect(metrics.recordPaymentReconciliationRun).toHaveBeenCalledWith(1);

    expect(appLogger.error).not.toHaveBeenCalled();
    expect(appLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_completed',
        resultCount: 1,
        resolvedCount: 0,
      }),
      'PaymentReconciliationService',
    );
  });

  it('emits scheduled_job_failed and rethrows when the sweep-level lookup itself fails', async () => {
    const boom = new Error('database unavailable');
    paymentsRepository.findPendingPayments.mockRejectedValue(boom);

    await expect(service.reconcilePendingPayments()).rejects.toThrow(
      'database unavailable',
    );

    expect(appLogger.log).not.toHaveBeenCalled();
    expect(appLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'scheduled_job_failed',
        job: 'payment-reconciliation',
        queue: 'payments',
        reason: 'database unavailable',
      }),
      boom.stack,
      'PaymentReconciliationService',
    );
    expect(typeof lastPayload(appLogger.error).durationMs).toBe('number');
  });
});
