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
  };
  let razorpayProvider: {
    verifyPaymentSignature: jest.Mock;
    verifyWebhookSignature: jest.Mock;
    fetchPayment: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let queueService: { addNotificationJob: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let auditService: { log: jest.Mock };
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
    };
    razorpayProvider = {
      verifyPaymentSignature: jest.fn().mockResolvedValue(true),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      fetchPayment: jest.fn().mockResolvedValue({
        amount: 50000,
        currency: 'INR',
        status: 'captured',
      }),
    };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    queueService = {
      addNotificationJob: jest.fn().mockResolvedValue(undefined),
    };
    logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    service = new PaymentsService(
      paymentsRepository as any,
      razorpayProvider as any,
      eventBus as any,
      queueService as any,
      {} as any, // prisma — unused directly by the methods under test
      logger as any,
      auditService as any,
    );
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
});
