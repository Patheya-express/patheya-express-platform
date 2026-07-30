import { randomUUID } from 'crypto';

import { PaymentProvider, TransactionStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { PaymentsRepository } from '../repositories/payments.repository';
import { PaymentsService } from './payments.service';

/**
 * Sprint 1.5 — real-database concurrency proof for payment verification. Every other payments
 * spec mocks Prisma entirely, which is correct for business-logic coverage but cannot prove the
 * atomic conditional-UPDATE claim (PaymentsRepository.claimStatusTransition) actually prevents
 * double-processing under genuine concurrent load — a mock has no row-locking semantics to get
 * wrong. This runs real, concurrent `Promise.allSettled` batches against a real Postgres
 * connection (same `DATABASE_URL` every other `db:*`/concurrency spec in this codebase assumes)
 * and asserts on the actual row state afterward. Creates and cleans up its own User/Order/Payment
 * rows; touches no other data. Mirrors the structure of
 * coupons/repositories/coupons.repository.concurrency.spec.ts (Sprint 1.3).
 *
 * The Razorpay provider itself is faked (no real HTTP call to Razorpay) — what's under real test
 * here is the database race, not Razorpay's API. eventBus/queueService are also faked so the
 * number of downstream side-effect invocations can be counted precisely across concurrent calls.
 */
describe('PaymentsService.verifyPayment — concurrency (real database)', () => {
  const prisma = new PrismaService({
    warn: () => undefined,
  } as unknown as AppLoggerService);
  const paymentsRepository = new PaymentsRepository(prisma);
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  let restaurantId: string | null = null;

  beforeAll(async () => {
    await prisma.$connect();
    const restaurant = await prisma.restaurant.findFirst({
      select: { id: true },
    });
    restaurantId = restaurant?.id ?? null;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // Payment rows cascade-delete with their Order (schema.prisma: onDelete: Cascade).
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createTestUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Test',
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createTestOrder(customerId: string): Promise<string> {
    if (!restaurantId) {
      throw new Error(
        'No restaurant available in the dev database for this test.',
      );
    }
    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        orderNumber: `ORD-PAYCONC-${randomUUID().slice(0, 8)}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 500,
        deliveryAddress: 'Concurrency test address',
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  async function createTestPayment(orderId: string, amount = 500) {
    return paymentsRepository.createPayment({
      orderId,
      provider: PaymentProvider.RAZORPAY,
      amount,
      providerOrderId: `order_conc_${randomUUID().slice(0, 12)}`,
      attemptNumber: 1,
      isActive: true,
    });
  }

  function buildService(razorpayOverrides: Record<string, unknown> = {}) {
    const razorpayProvider = {
      verifySignature: jest.fn().mockResolvedValue(true),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      fetchPayment: jest.fn().mockResolvedValue({
        amount: 50000,
        currency: 'INR',
        status: 'captured',
      }),
      ...razorpayOverrides,
    };
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const queueService = {
      addNotificationJob: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const service = new PaymentsService(
      paymentsRepository,
      razorpayProvider as any,
      eventBus as any,
      queueService as any,
      prisma,
      logger as any,
      auditService as any,
    );

    return { service, razorpayProvider, eventBus, queueService };
  }

  it('claimStatusTransition: N concurrent claims on the same PENDING payment — exactly one wins', async () => {
    const customerId = await createTestUser();
    const orderId = await createTestOrder(customerId);
    const payment = await createTestPayment(orderId);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        paymentsRepository.claimStatusTransition(
          payment.id,
          [TransactionStatus.PENDING],
          TransactionStatus.SUCCESS,
          `pay_${randomUUID().slice(0, 10)}`,
        ),
      ),
    );

    const claimCounts = results
      .filter(
        (r): r is PromiseFulfilledResult<{ count: number }> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value.count);

    expect(claimCounts.filter((count) => count === 1)).toHaveLength(1);
    expect(claimCounts.filter((count) => count === 0)).toHaveLength(9);

    const finalPayment = await paymentsRepository.findById(payment.id);
    expect(finalPayment?.status).toBe(TransactionStatus.SUCCESS);
  }, 20000);

  it('verifyPayment: N concurrent verification requests for the same payment — downstream effects fire exactly once', async () => {
    const customerId = await createTestUser();
    const orderId = await createTestOrder(customerId);
    const payment = await createTestPayment(orderId);
    const { service, eventBus, queueService } = buildService();

    const payload = {
      razorpay_order_id: payment.providerOrderId,
      razorpay_payment_id: `pay_${randomUUID().slice(0, 10)}`,
      razorpay_signature: 'irrelevant-because-verifySignature-is-mocked',
    };

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.verifyPayment(payload, customerId),
      ),
    );

    // Every concurrent call either succeeds outright or (if it happened to lose the atomic
    // claim race to a transition that was never actually invalid — i.e. the identical SUCCESS
    // outcome) is handled gracefully by transitionPaymentStatus's re-read branch. None should
    // reject.
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(0);

    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value.status).toBe(TransactionStatus.SUCCESS);
      }
    }

    // The whole point: ten concurrent "the payment succeeded" requests must never fire the
    // success side effects (order confirmation, notification) more than once.
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(queueService.addNotificationJob).toHaveBeenCalledTimes(1);

    const finalPayment = await paymentsRepository.findById(payment.id);
    expect(finalPayment?.status).toBe(TransactionStatus.SUCCESS);
  }, 20000);

  it('replay: verifying an already-SUCCESS payment again (sequentially, after the fact) does not re-fire downstream effects', async () => {
    const customerId = await createTestUser();
    const orderId = await createTestOrder(customerId);
    const payment = await createTestPayment(orderId);
    const { service, eventBus, queueService } = buildService();

    const payload = {
      razorpay_order_id: payment.providerOrderId,
      razorpay_payment_id: `pay_${randomUUID().slice(0, 10)}`,
      razorpay_signature: 'irrelevant-because-verifySignature-is-mocked',
    };

    const first = await service.verifyPayment(payload, customerId);
    expect(first.status).toBe(TransactionStatus.SUCCESS);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);

    // A genuine replay: same exact payload, presented again minutes later (e.g. a stale browser
    // tab resubmitting, or a network layer retrying a "successful but the ack was lost" call).
    const second = await service.verifyPayment(payload, customerId);
    expect(second.status).toBe(TransactionStatus.SUCCESS);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(queueService.addNotificationJob).toHaveBeenCalledTimes(1);
  }, 20000);

  it('a mismatched captured amount is rejected and never transitions the payment', async () => {
    const customerId = await createTestUser();
    const orderId = await createTestOrder(customerId);
    const payment = await createTestPayment(orderId, 500);
    const { service } = buildService({
      fetchPayment: jest
        .fn()
        .mockResolvedValue({ amount: 1, currency: 'INR', status: 'captured' }),
    });

    const payload = {
      razorpay_order_id: payment.providerOrderId,
      razorpay_payment_id: `pay_${randomUUID().slice(0, 10)}`,
      razorpay_signature: 'irrelevant-because-verifySignature-is-mocked',
    };

    await expect(service.verifyPayment(payload, customerId)).rejects.toThrow();

    const finalPayment = await paymentsRepository.findById(payment.id);
    expect(finalPayment?.status).toBe(TransactionStatus.PENDING);
  }, 20000);

  it("ownership: a different customer cannot verify someone else's payment, even with a valid signature", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const orderId = await createTestOrder(owner);
    const payment = await createTestPayment(orderId);
    const { service } = buildService();

    const payload = {
      razorpay_order_id: payment.providerOrderId,
      razorpay_payment_id: `pay_${randomUUID().slice(0, 10)}`,
      razorpay_signature: 'irrelevant-because-verifySignature-is-mocked',
    };

    await expect(service.verifyPayment(payload, attacker)).rejects.toThrow();

    const finalPayment = await paymentsRepository.findById(payment.id);
    expect(finalPayment?.status).toBe(TransactionStatus.PENDING);
  }, 20000);
});
