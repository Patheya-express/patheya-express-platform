import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { TransactionStatus } from '@prisma/client';

import { PaymentsService } from './payments.service';

/**
 * Sprint 1.5 — payment verification security hardening. Covers the checklist from the sprint
 * spec: valid payment, invalid signature, wrong order, different customer, replay/duplicate
 * verification, duplicate webhook, concurrent verification (the claim-loses-the-race branch),
 * failed payment, and Redis-unavailable resilience. Only PaymentsService is under test — its
 * dependencies (repository, Razorpay provider, event bus, queue) are all mocked, matching this
 * codebase's established unit-test convention (see CouponsService.spec.ts).
 */
describe('PaymentsService', () => {
  let paymentsRepository: {
    findByProviderOrderId: jest.Mock;
    findByProviderOrderIdWithOwner: jest.Mock;
    findById: jest.Mock;
    deactivateOrderAttempts: jest.Mock;
    claimStatusTransition: jest.Mock;
    createWebhookEvent: jest.Mock;
    findActivePaymentForOrder: jest.Mock;
    findLatestAttempt: jest.Mock;
    createPayment: jest.Mock;
    claimRefund: jest.Mock;
    finalizeRefundFailure: jest.Mock;
    finalizeRefundSuccess: jest.Mock;
  };
  let razorpayProvider: {
    verifyPaymentSignature: jest.Mock;
    verifyWebhookSignature: jest.Mock;
    fetchPayment: jest.Mock;
    createOrder: jest.Mock;
    refund: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let queueService: { addNotificationJob: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let auditService: { log: jest.Mock };
  let metrics: { recordRefundFailed: jest.Mock };
  let service: PaymentsService;

  const CUSTOMER_ID = 'customer-1';
  const OTHER_CUSTOMER_ID = 'customer-2';

  function buildPayment(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'payment-1',
      orderId: 'order-1',
      provider: 'RAZORPAY',
      providerOrderId: 'order_rzp_1',
      providerPaymentId: null,
      amount: 500,
      status: TransactionStatus.PENDING,
      method: null,
      attemptNumber: 1,
      isActive: true,
      order: { customerId: CUSTOMER_ID },
      ...overrides,
    };
  }

  const VALID_PAYLOAD = {
    razorpay_order_id: 'order_rzp_1',
    razorpay_payment_id: 'pay_rzp_1',
    razorpay_signature: 'genuine-signature',
  };

  beforeEach(() => {
    paymentsRepository = {
      findByProviderOrderId: jest.fn(),
      findByProviderOrderIdWithOwner: jest.fn(),
      findById: jest.fn(),
      deactivateOrderAttempts: jest.fn().mockResolvedValue({ count: 1 }),
      claimStatusTransition: jest.fn(),
      createWebhookEvent: jest.fn().mockResolvedValue(undefined),
      findActivePaymentForOrder: jest.fn().mockResolvedValue(null),
      findLatestAttempt: jest.fn().mockResolvedValue(null),
      createPayment: jest
        .fn()
        .mockImplementation((data) =>
          Promise.resolve({ id: 'payment-1', ...data }),
        ),
      claimRefund: jest.fn(),
      finalizeRefundFailure: jest.fn().mockResolvedValue({ count: 1 }),
      finalizeRefundSuccess: jest.fn().mockResolvedValue({
        paymentClaimCount: 1,
        refundClaimCount: 1,
      }),
    };
    razorpayProvider = {
      verifyPaymentSignature: jest.fn().mockResolvedValue(true),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      fetchPayment: jest.fn().mockResolvedValue({
        amount: 50000,
        currency: 'INR',
        status: 'captured',
      }),
      createOrder: jest.fn().mockResolvedValue({
        id: 'order_rzp_1',
        amount: 22000,
        currency: 'INR',
      }),
      refund: jest.fn(),
    };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    queueService = {
      addNotificationJob: jest.fn().mockResolvedValue(undefined),
    };
    logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    metrics = { recordRefundFailed: jest.fn() };

    service = new PaymentsService(
      paymentsRepository as any,
      razorpayProvider as any,
      eventBus as any,
      queueService as any,
      {} as any, // prisma — unused directly by the methods under test
      logger as any,
      auditService as any,
      metrics as any,
    );
  });

  /**
   * Payment/order lifecycle "Payment Eligibility" — regression coverage for
   * PAYABLE_ORDER_STATUSES enforcement in createPayment: PENDING/CONFIRMED/PREPARING/
   * READY_FOR_PICKUP/OUT_FOR_DELIVERY orders may still be paid for (covers both the initial
   * ONLINE checkout payment and, for a COD order, the "Complete Payment" online top-up);
   * DELIVERED/CANCELLED may not. Uses a local `prisma.order.findUnique` mock + a separately
   * constructed service instance (the outer `beforeEach` above deliberately stubs prisma as
   * unused, since none of the pre-existing suites below call createPayment).
   */
  describe('createPayment', () => {
    let prisma: { order: { findUnique: jest.Mock } };
    let localService: PaymentsService;

    function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        customerId: CUSTOMER_ID,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        totalAmount: 220,
        walletAmountUsed: 0,
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma = { order: { findUnique: jest.fn() } };
      localService = new PaymentsService(
        paymentsRepository as any,
        razorpayProvider as any,
        eventBus as any,
        queueService as any,
        prisma as any,
        logger as any,
        auditService as any,
        metrics as any,
      );
    });

    it.each([
      'PENDING',
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'OUT_FOR_DELIVERY',
    ])(
      'allows initiating payment for an order in %s status',
      async (status) => {
        prisma.order.findUnique.mockResolvedValue(buildOrder({ status }));

        await expect(
          localService.createPayment('order-1', 220, CUSTOMER_ID),
        ).resolves.toMatchObject({ payment: expect.anything() });
      },
    );

    it.each(['DELIVERED', 'CANCELLED'])(
      'rejects initiating payment for an order in %s status',
      async (status) => {
        prisma.order.findUnique.mockResolvedValue(buildOrder({ status }));

        await expect(
          localService.createPayment('order-1', 220, CUSTOMER_ID),
        ).rejects.toThrow(ConflictException);
      },
    );

    it('is payment-mode-agnostic — a COD order in a payable status can still initiate an online payment (Rule 6, "Complete Payment")', async () => {
      // paymentMode isn't selected/read by createPayment at all — this just documents that a COD
      // order (status already advanced by restaurant acceptance, exactly like Rule 6's example
      // flow) goes through the identical, unmodified eligibility check as an ONLINE order.
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: 'OUT_FOR_DELIVERY' }),
      );

      await expect(
        localService.createPayment('order-1', 220, CUSTOMER_ID),
      ).resolves.toMatchObject({ payment: expect.anything() });
    });

    it('still rejects an already-paid order regardless of status', async () => {
      prisma.order.findUnique.mockResolvedValue(
        buildOrder({ status: 'PREPARING', paymentStatus: 'PAID' }),
      );

      await expect(
        localService.createPayment('order-1', 220, CUSTOMER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyPayment', () => {
    it('a valid payment is verified, transitioned to SUCCESS, and downstream effects fire exactly once', async () => {
      const pending = buildPayment();
      const succeeded = buildPayment({ status: TransactionStatus.SUCCESS });
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        pending,
      );
      paymentsRepository.claimStatusTransition.mockResolvedValue({ count: 1 });
      // transitionPaymentStatus calls findById twice: once up front (to check the current
      // status before attempting the claim) and once after a successful claim (to return the
      // fresh row) — must see PENDING then SUCCESS, not the same value both times.
      paymentsRepository.findById
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(succeeded);

      const result = await service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID);

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(paymentsRepository.claimStatusTransition).toHaveBeenCalledWith(
        'payment-1',
        [TransactionStatus.PENDING],
        TransactionStatus.SUCCESS,
        'pay_rzp_1',
        undefined,
      );
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith('payment.success', {
        paymentId: 'payment-1',
        orderId: 'order-1',
      });
      expect(queueService.addNotificationJob).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid signature and never touches the database', async () => {
      razorpayProvider.verifyPaymentSignature.mockResolvedValue(false);

      await expect(
        service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID),
      ).rejects.toThrow(ConflictException);

      expect(
        paymentsRepository.findByProviderOrderIdWithOwner,
      ).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('rejects verification for an order_id that has no matching payment', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(null);

      await expect(
        service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects verification by a different customer than the one who owns the order', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment(),
      );

      await expect(
        service.verifyPayment(VALID_PAYLOAD, OTHER_CUSTOMER_ID),
      ).rejects.toThrow(ForbiddenException);

      expect(paymentsRepository.claimStatusTransition).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('rejects verification when the amount Razorpay actually captured does not match the order', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment({ amount: 500 }),
      );
      razorpayProvider.fetchPayment.mockResolvedValue({
        amount: 1,
        currency: 'INR',
        status: 'captured',
      });

      await expect(
        service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID),
      ).rejects.toThrow(ConflictException);
      expect(paymentsRepository.claimStatusTransition).not.toHaveBeenCalled();
    });

    it('rejects verification when Razorpay reports the payment as not captured', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment(),
      );
      razorpayProvider.fetchPayment.mockResolvedValue({
        amount: 50000,
        currency: 'INR',
        status: 'authorized',
      });

      await expect(
        service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects verification when the currency does not match', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment(),
      );
      razorpayProvider.fetchPayment.mockResolvedValue({
        amount: 50000,
        currency: 'USD',
        status: 'captured',
      });

      await expect(
        service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('replaying an already-verified payment is a no-op: returns success without re-publishing any downstream effect', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment({ status: TransactionStatus.SUCCESS }),
      );

      const result = await service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID);

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(paymentsRepository.claimStatusTransition).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(queueService.addNotificationJob).not.toHaveBeenCalled();
    });

    it('concurrent verification: losing the atomic claim race to an identical outcome still returns success, not an error', async () => {
      // Models two requests (e.g. the client verify call and the Razorpay webhook) racing for
      // the same payment: this call's findById read sees PENDING, but by the time its claim
      // runs, the other request already committed SUCCESS — claimStatusTransition affects zero
      // rows, and the re-read after that confirms the row is already in the target state.
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment(),
      );
      paymentsRepository.claimStatusTransition.mockResolvedValue({ count: 0 });
      paymentsRepository.findById
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.PENDING }),
        )
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.SUCCESS }),
        );

      const result = await service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID);

      expect(result.status).toBe(TransactionStatus.SUCCESS);
    });

    it('concurrent verification: losing the claim to a genuinely invalid transition surfaces a conflict, not silent success', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment(),
      );
      paymentsRepository.claimStatusTransition.mockResolvedValue({ count: 0 });
      // The row moved to FAILED in between — SUCCESS is genuinely unreachable from FAILED.
      paymentsRepository.findById
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.PENDING }),
        )
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.FAILED }),
        );

      await expect(
        service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('Redis/BullMQ being unavailable does not fail verification — the payment is still marked SUCCESS', async () => {
      paymentsRepository.findByProviderOrderIdWithOwner.mockResolvedValue(
        buildPayment(),
      );
      paymentsRepository.claimStatusTransition.mockResolvedValue({ count: 1 });
      paymentsRepository.findById
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.PENDING }),
        )
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.SUCCESS }),
        );
      queueService.addNotificationJob.mockRejectedValue(
        new Error('Redis connection refused'),
      );

      const result = await service.verifyPayment(VALID_PAYLOAD, CUSTOMER_ID);

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('processWebhook — captured event', () => {
    function webhookPayload(entity: Partial<Record<string, unknown>> = {}) {
      return {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_1',
              order_id: 'order_rzp_1',
              amount: 50000,
              currency: 'INR',
              method: 'upi',
              ...entity,
            },
          },
        },
      };
    }

    it('rejects a webhook with an invalid signature before processing anything', async () => {
      razorpayProvider.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        service.processWebhook(webhookPayload(), '{}', 'bad-signature'),
      ).rejects.toThrow(UnauthorizedException);

      expect(paymentsRepository.findByProviderOrderId).not.toHaveBeenCalled();
    });

    it('a valid captured webhook transitions the payment to SUCCESS', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(
        buildPayment(),
      );
      paymentsRepository.claimStatusTransition.mockResolvedValue({ count: 1 });
      paymentsRepository.findById
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.PENDING }),
        )
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.SUCCESS }),
        );

      await service.processWebhook(webhookPayload(), '{}', 'valid-signature');

      expect(paymentsRepository.claimStatusTransition).toHaveBeenCalledWith(
        'payment-1',
        [TransactionStatus.PENDING],
        TransactionStatus.SUCCESS,
        'pay_rzp_1',
        'UPI',
      );
      expect(eventBus.publish).toHaveBeenCalledWith('payment.success', {
        paymentId: 'payment-1',
        orderId: 'order-1',
      });
    });

    it('a duplicate delivery of the same captured webhook is a no-op', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(
        buildPayment({ status: TransactionStatus.SUCCESS }),
      );

      await service.processWebhook(webhookPayload(), '{}', 'valid-signature');

      expect(paymentsRepository.claimStatusTransition).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('a captured webhook whose amount does not match the expected order amount is not applied', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(
        buildPayment({ amount: 500 }),
      );

      await service.processWebhook(
        webhookPayload({ amount: 1 }),
        '{}',
        'valid-signature',
      );

      expect(paymentsRepository.claimStatusTransition).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('still acknowledges (does not throw for) a webhook referencing an unknown order', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(null);

      await expect(
        service.processWebhook(webhookPayload(), '{}', 'valid-signature'),
      ).resolves.toEqual({ success: true });
    });

    it('records every received webhook event for audit, even ones that do not change payment state', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(
        buildPayment({ status: TransactionStatus.SUCCESS }),
      );

      await service.processWebhook(webhookPayload(), '{}', 'valid-signature');

      expect(paymentsRepository.createWebhookEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('processWebhook — failed event', () => {
    function failedWebhookPayload() {
      return {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: { id: 'pay_rzp_1', order_id: 'order_rzp_1' },
          },
        },
      };
    }

    it('a failed-payment webhook transitions the payment to FAILED and publishes payment.failed', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(
        buildPayment(),
      );
      paymentsRepository.claimStatusTransition.mockResolvedValue({ count: 1 });
      paymentsRepository.findById
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.PENDING }),
        )
        .mockResolvedValueOnce(
          buildPayment({ status: TransactionStatus.FAILED }),
        );

      await service.processWebhook(
        failedWebhookPayload(),
        '{}',
        'valid-signature',
      );

      expect(paymentsRepository.claimStatusTransition).toHaveBeenCalledWith(
        'payment-1',
        [TransactionStatus.PENDING],
        TransactionStatus.FAILED,
        'pay_rzp_1',
        undefined,
      );
      expect(eventBus.publish).toHaveBeenCalledWith('payment.failed', {
        paymentId: 'payment-1',
        orderId: 'order-1',
      });
    });

    it('a duplicate failed-payment webhook is a no-op', async () => {
      paymentsRepository.findByProviderOrderId.mockResolvedValue(
        buildPayment({ status: TransactionStatus.FAILED }),
      );

      await service.processWebhook(
        failedWebhookPayload(),
        '{}',
        'valid-signature',
      );

      expect(paymentsRepository.claimStatusTransition).not.toHaveBeenCalled();
    });
  });

  /**
   * P0-FIN-1B — regression coverage for the new `patheya_refunds_failed_total` counter
   * (MetricsService.recordRefundFailed). Only the metrics call is under test here; refundPayment's
   * own claim/reversal/idempotency behavior is unchanged and already covered by
   * refund-integrity.concurrency.spec.ts (real database).
   */
  describe('refundPayment — failed refund metric', () => {
    function buildClaimedRefund(
      overrides: Partial<Record<string, unknown>> = {},
    ) {
      return {
        claimed: true as const,
        payment: buildPayment({
          status: TransactionStatus.SUCCESS,
          providerPaymentId: 'pay_rzp_1',
        }),
        refund: { id: 'refund-1', paymentId: 'payment-1', amount: 500 },
        ...overrides,
      };
    }

    it('a failed provider refund increments the counter exactly once', async () => {
      paymentsRepository.claimRefund.mockResolvedValue(buildClaimedRefund());
      razorpayProvider.refund = jest
        .fn()
        .mockRejectedValue(new Error('ECONNRESET'));
      razorpayProvider.fetchPayment.mockResolvedValue({
        refund_status: 'none',
        amount_refunded: 0,
      });

      await expect(service.refundPayment('payment-1', 500)).rejects.toThrow(
        ConflictException,
      );

      expect(paymentsRepository.finalizeRefundFailure).toHaveBeenCalledWith(
        'refund-1',
      );
      expect(metrics.recordRefundFailed).toHaveBeenCalledTimes(1);
    });

    it('a successful refund does not increment the failure counter', async () => {
      paymentsRepository.claimRefund.mockResolvedValue(buildClaimedRefund());
      razorpayProvider.refund = jest.fn().mockResolvedValue({ id: 'rfnd_1' });
      paymentsRepository.findById.mockResolvedValue(
        buildPayment({ status: TransactionStatus.REFUNDED }),
      );

      await service.refundPayment('payment-1', 500);

      expect(metrics.recordRefundFailed).not.toHaveBeenCalled();
    });

    it('two independent failed refund attempts increment the counter once each (twice total)', async () => {
      paymentsRepository.claimRefund
        .mockResolvedValueOnce(
          buildClaimedRefund({ refund: { id: 'refund-1' } }),
        )
        .mockResolvedValueOnce(
          buildClaimedRefund({ refund: { id: 'refund-2' } }),
        );
      razorpayProvider.refund = jest
        .fn()
        .mockRejectedValue(new Error('ECONNRESET'));
      razorpayProvider.fetchPayment.mockResolvedValue({
        refund_status: 'none',
        amount_refunded: 0,
      });

      await expect(service.refundPayment('payment-1', 500)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.refundPayment('payment-2', 500)).rejects.toThrow(
        ConflictException,
      );

      expect(metrics.recordRefundFailed).toHaveBeenCalledTimes(2);
    });
  });
});
