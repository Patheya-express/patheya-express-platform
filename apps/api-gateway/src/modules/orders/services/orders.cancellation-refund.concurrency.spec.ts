import { randomUUID } from 'crypto';

import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CouponScope,
  CouponType,
  OrderStatus,
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  TransactionStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { OrdersRepository } from '../repositories/orders.repository';
import { OrdersService } from './orders.service';
import { PaymentsRepository } from '../../payments/repositories/payments.repository';
import { PaymentsService } from '../../payments/services/payments.service';
import { CouponsRepository } from '../../coupons/repositories/coupons.repository';
import { CouponsService } from '../../coupons/services/coupons.service';
import type { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

/**
 * P0 fix (2026-09 production-readiness audit — "a paid order can be cancelled through the normal
 * cancellation path without the existing refund workflow ever running") — real-database
 * concurrency proof for OrdersService.handleCancellationSideEffects, exercised through its two
 * callers (updateOrderStatus, adminCancelOrder). Mirrors refund-integrity.concurrency.spec.ts and
 * payments.concurrency.spec.ts: runs real concurrent `Promise.all`/`Promise.allSettled` batches
 * against a real Postgres connection and asserts on actual row state — nothing here is mockable,
 * since what's under test is whether the *real* OrdersRepository.claimPaymentStatusTransition
 * claim (reused unchanged from refundOrder) actually serializes concurrent cancellations the same
 * way it already serializes concurrent explicit refunds.
 *
 * The Razorpay provider is faked (no real HTTP call) — what's under test is the database race and
 * this new orchestration layer, not Razorpay's API. eventBus/realtimeService/queueService/
 * redisService/auditService/deliveryService/restaurantsService/addressesService/
 * pricingEngineService are also faked; none of them sit on the money/coupon path this fix touches.
 */
describe('OrdersService cancellation — refund/coupon concurrency (real database)', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );
  const ordersRepository = new OrdersRepository(prisma);
  const paymentsRepository = new PaymentsRepository(prisma);
  const couponsRepository = new CouponsRepository(prisma);
  const couponsService = new CouponsService(couponsRepository, {} as any);

  const fakeLogger = {
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
  } as unknown as AppLoggerService;

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCouponIds: string[] = [];

  let restaurantId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const restaurant = await prisma.restaurant.findFirst({
      select: { id: true },
    });

    if (!restaurant) {
      throw new Error(
        'No restaurant row found in the test database — seed one before running cancellation concurrency specs.',
      );
    }

    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // Payment/Refund/CouponRedemption/DeliveryAssignment rows cascade-delete with their Order
      // (schema.prisma: onDelete: Cascade throughout this chain).
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdCouponIds.length > 0) {
      await prisma.coupon.deleteMany({
        where: { id: { in: createdCouponIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createCustomer(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createAdmin(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Admin',
        role: UserRole.ADMIN,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createOrder(
    customerId: string,
    overrides: {
      status?: OrderStatus;
      paymentMode?: PaymentMode;
      paymentStatus?: PaymentStatus;
      totalAmount?: number;
      walletAmountUsed?: number;
    } = {},
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        orderNumber: `ORD-CXCONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: overrides.totalAmount ?? 565,
        walletAmountUsed: overrides.walletAmountUsed ?? 0,
        deliveryAddress: 'Concurrency test address',
        status: overrides.status ?? OrderStatus.CONFIRMED,
        paymentMode: overrides.paymentMode ?? PaymentMode.ONLINE,
        paymentStatus: overrides.paymentStatus ?? PaymentStatus.PAID,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  async function createSuccessfulPayment(
    orderId: string,
    amount = 565,
  ): Promise<string> {
    const payment = await prisma.payment.create({
      data: {
        orderId,
        provider: PaymentProvider.RAZORPAY,
        amount,
        status: TransactionStatus.SUCCESS,
        providerOrderId: `order_rzp_${randomUUID().slice(0, 12)}`,
        providerPaymentId: `pay_rzp_${randomUUID().slice(0, 12)}`,
      },
    });
    return payment.id;
  }

  async function createRedeemedCoupon(orderId: string, userId: string) {
    const coupon = await prisma.coupon.create({
      data: {
        code: `CXCONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Cancellation concurrency test coupon',
        type: CouponType.FLAT,
        value: 10,
        minOrderAmount: 0,
        scope: CouponScope.PLATFORM,
        usageLimit: null,
        usagePerUser: 1,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        active: true,
        totalUsed: 1,
      },
    });
    createdCouponIds.push(coupon.id);

    const redemption = await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        userId,
        orderId,
        discountAmount: 10,
      },
    });

    return { couponId: coupon.id, redemptionId: redemption.id };
  }

  /** Builds a real OrdersService backed by real Orders/Payments/Coupons repositories and a real
   *  PaymentsService, with only the Razorpay provider and the non-money/coupon collaborators
   *  faked — see the describe block's own doc comment for why. */
  function buildService(razorpayOverrides: Record<string, unknown> = {}) {
    const razorpayProvider = {
      refund: jest
        .fn()
        .mockResolvedValue({ id: `rfnd_${randomUUID().slice(0, 10)}` }),
      fetchPayment: jest.fn().mockResolvedValue({
        refund_status: 'full',
        amount_refunded: 56500,
      }),
      ...razorpayOverrides,
    };
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const queueService = {
      addNotificationJob: jest.fn().mockResolvedValue(undefined),
    };
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const metrics = { recordRefundFailed: jest.fn() };

    const paymentsService = new PaymentsService(
      paymentsRepository,
      razorpayProvider as any,
      eventBus as any,
      queueService as any,
      prisma,
      fakeLogger,
      auditService as any,
      metrics as any,
    );

    const realtimeService = { emitToOrder: jest.fn() };
    const deliveryService = {
      releasePartnerFromDelivery: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrdersService(
      prisma,
      ordersRepository,
      eventBus as any,
      deliveryService as any,
      paymentsService,
      {} as any, // restaurantsService — not on the cancellation/refund/coupon path
      {} as any, // addressesService
      realtimeService as any,
      {} as any, // queueService (Orders-level)
      {} as any, // redisService
      auditService as any,
      fakeLogger,
      {} as any, // pricingEngineService
      couponsService,
    );

    return { service, razorpayProvider, eventBus, metrics };
  }

  const customerUser = (userId: string): AuthenticatedUser => ({
    userId,
    role: UserRole.CUSTOMER,
  });
  const adminUser = (userId: string): AuthenticatedUser => ({
    userId,
    role: UserRole.ADMIN,
  });

  // ---------------------------------------------------------------------------------------
  // TEST 1 — two concurrent cancellation requests for the same PAID order
  // ---------------------------------------------------------------------------------------
  it('TEST 1: two concurrent cancellation requests for the same PAID order result in one cancellation and at most one refund', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId);
    await createSuccessfulPayment(orderId);
    const { service, razorpayProvider } = buildService();

    const results = await Promise.allSettled([
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.CANCELLED } as any,
        customerUser(customerId),
      ),
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.CANCELLED } as any,
        customerUser(customerId),
      ),
    ]);

    // Both cancellation requests succeed from the caller's point of view — CANCELLED is idempotent
    // to write, and handleCancellationSideEffects never lets a lost refund race fail the caller.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(finalOrder.status).toBe(OrderStatus.CANCELLED);
    expect(finalOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);

    const refundCount = await prisma.refund.count({
      where: { payment: { orderId } },
    });
    expect(refundCount).toBe(1);
    expect(razorpayProvider.refund).toHaveBeenCalledTimes(1);
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 2 — cancellation racing an explicit admin refund
  // ---------------------------------------------------------------------------------------
  it('TEST 2: cancellation racing an explicit admin refund resolves to exactly one refund outcome', async () => {
    const customerId = await createCustomer();
    const adminId = await createAdmin();
    const orderId = await createOrder(customerId);
    await createSuccessfulPayment(orderId);
    const { service, razorpayProvider } = buildService();

    const results = await Promise.allSettled([
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.CANCELLED } as any,
        customerUser(customerId),
      ),
      service.refundOrder(orderId, {}, adminId),
    ]);

    // The cancellation call always succeeds (its own status write is unconditional); the direct
    // refundOrder call is the one that can legitimately lose the exactly-once claim and reject.
    const [cancelResult, refundResult] = results;
    expect(cancelResult.status).toBe('fulfilled');
    if (refundResult.status === 'rejected') {
      expect(refundResult.reason).toBeInstanceOf(ConflictException);
    }

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(finalOrder.status).toBe(OrderStatus.CANCELLED);
    expect(finalOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);

    const refundCount = await prisma.refund.count({
      where: { payment: { orderId } },
    });
    expect(refundCount).toBe(1);
    expect(razorpayProvider.refund).toHaveBeenCalledTimes(1);
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 3 — cancellation racing a different, non-cancelling valid transition
  // ---------------------------------------------------------------------------------------
  it('TEST 3: cancellation racing a different valid transition (restaurant/admin moving the order to PREPARING) never leaves a non-cancelled order refunded', async () => {
    const customerId = await createCustomer();
    const adminId = await createAdmin();
    const orderId = await createOrder(customerId, {
      status: OrderStatus.CONFIRMED,
    });
    await createSuccessfulPayment(orderId);
    const { service } = buildService();

    const results = await Promise.allSettled([
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.CANCELLED } as any,
        customerUser(customerId),
      ),
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.PREPARING } as any,
        adminUser(adminId),
      ),
    ]);

    // ordersRepository.updateOrderStatus is a plain unconditional write (pre-existing, separately
    // tracked limitation — not something this fix re-implements), so exactly which of these two
    // valid transitions "wins" the last write is not deterministic. Both calls are expected to
    // resolve — the loser's status write still lands, it's just overwritten milliseconds later.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });

    // The state-machine invariant: the final status is always one of the two legally-attempted
    // values (Prisma's typed enum write makes a third, corrupted value structurally impossible).
    expect([OrderStatus.CANCELLED, OrderStatus.PREPARING]).toContain(
      finalOrder.status,
    );

    // The actual invariant this fix adds (Invariant H / F): an order that did NOT end up
    // cancelled must never have been refunded, no matter which call's local, pre-write read of
    // "this order is PAID and about to be cancelled" it was racing against.
    if (finalOrder.status !== OrderStatus.CANCELLED) {
      expect(finalOrder.paymentStatus).toBe(PaymentStatus.PAID);

      const refundCount = await prisma.refund.count({
        where: { payment: { orderId } },
      });
      expect(refundCount).toBe(0);
    }
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 4 — cancellation of an unpaid/COD order
  // ---------------------------------------------------------------------------------------
  it('TEST 4: cancelling an unpaid COD order succeeds and never creates a payment refund', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, {
      status: OrderStatus.PENDING,
      paymentMode: PaymentMode.COD,
      paymentStatus: PaymentStatus.PENDING,
    });
    const { service, razorpayProvider } = buildService();

    const result = await service.updateOrderStatus(
      orderId,
      { status: OrderStatus.CANCELLED },
      customerUser(customerId),
    );

    expect(result.status).toBe(OrderStatus.CANCELLED);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(finalOrder.paymentStatus).toBe(PaymentStatus.PENDING);

    const paymentCount = await prisma.payment.count({ where: { orderId } });
    expect(paymentCount).toBe(0);
    expect(razorpayProvider.refund).not.toHaveBeenCalled();
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 5 — refund provider failure
  // ---------------------------------------------------------------------------------------
  it('TEST 5: cancellation still succeeds when the refund provider fails, the order is never falsely shown refunded, a retry safely succeeds, and the failure metric fires exactly once (P0-FIN-1B)', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId);
    await createSuccessfulPayment(orderId);
    const { service, razorpayProvider, metrics } = buildService({
      refund: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      fetchPayment: jest
        .fn()
        .mockResolvedValue({ refund_status: 'none', amount_refunded: 0 }),
    });

    const result = await service.updateOrderStatus(
      orderId,
      { status: OrderStatus.CANCELLED },
      customerUser(customerId),
    );

    // The cancellation itself is never blocked by the refund failure (Invariant C).
    expect(result.status).toBe(OrderStatus.CANCELLED);

    const afterFailure = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    // Never falsely REFUNDED — reverted back to PAID by refundOrder's own catch block.
    expect(afterFailure.paymentStatus).toBe(PaymentStatus.PAID);

    const failedRefund = await prisma.refund.findFirst({
      where: { payment: { orderId } },
    });
    expect(failedRefund?.status).toBe(TransactionStatus.FAILED);

    // P0-FIN-1B: the failed-refund metric fires exactly once for this one failed attempt, even
    // though the error propagates through PaymentsService -> refundOrder's catch ->
    // handleCancellationSideEffects' catch before the cancel endpoint returns.
    expect(metrics.recordRefundFailed).toHaveBeenCalledTimes(1);

    // Retryable: a fresh refund attempt (e.g. an operator retrying via the admin refund
    // endpoint after seeing the cancellation_refund_failed log) succeeds cleanly.
    razorpayProvider.refund.mockResolvedValue({
      id: `rfnd_${randomUUID().slice(0, 10)}`,
    });
    const adminId = await createAdmin();
    await service.refundOrder(orderId, {}, adminId);

    const afterRetry = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(afterRetry.paymentStatus).toBe(PaymentStatus.REFUNDED);
    // The successful retry must not also increment the failure counter.
    expect(metrics.recordRefundFailed).toHaveBeenCalledTimes(1);
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 6 — repeated cancellation request after a successful refund
  // ---------------------------------------------------------------------------------------
  it('TEST 6: a repeated cancellation request after a successful refund is idempotent — no duplicate refund', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId);
    await createSuccessfulPayment(orderId);
    const { service, razorpayProvider } = buildService();

    const first = await service.updateOrderStatus(
      orderId,
      { status: OrderStatus.CANCELLED },
      customerUser(customerId),
    );
    expect(first.status).toBe(OrderStatus.CANCELLED);
    expect(razorpayProvider.refund).toHaveBeenCalledTimes(1);

    // (a) Retrying via the same cancel endpoint: CANCELLED has no further legal transitions
    // (pre-existing, unrelated to this fix), so the retry is rejected before this fix's code
    // ever runs again.
    await expect(
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.CANCELLED } as any,
        customerUser(customerId),
      ),
    ).rejects.toThrow(BadRequestException);

    // (b) A direct retry of the refund itself (e.g. an admin double-clicking "Refund"): the
    // existing exactly-once claim rejects it cleanly.
    const adminId = await createAdmin();
    await expect(service.refundOrder(orderId, {}, adminId)).rejects.toThrow(
      ConflictException,
    );

    expect(razorpayProvider.refund).toHaveBeenCalledTimes(1);
    const refundCount = await prisma.refund.count({
      where: { payment: { orderId } },
    });
    expect(refundCount).toBe(1);
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 7 — PAID order with a coupon
  // ---------------------------------------------------------------------------------------
  it('TEST 7: cancelling a PAID order with a coupon refunds the payment and releases the coupon exactly once', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId);
    await createSuccessfulPayment(orderId);
    const { couponId, redemptionId } = await createRedeemedCoupon(
      orderId,
      customerId,
    );
    const { service, razorpayProvider } = buildService();

    const result = await service.updateOrderStatus(
      orderId,
      { status: OrderStatus.CANCELLED },
      customerUser(customerId),
    );

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(razorpayProvider.refund).toHaveBeenCalledTimes(1);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(finalOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);

    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: couponId },
    });
    expect(finalCoupon.totalUsed).toBe(0);

    const redemption = await prisma.couponRedemption.findUnique({
      where: { id: redemptionId },
    });
    expect(redemption).toBeNull();
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // TEST 8 — PAID order without a coupon
  // ---------------------------------------------------------------------------------------
  it('TEST 8: cancelling a PAID order with no coupon refunds the payment with no coupon side effect', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId);
    await createSuccessfulPayment(orderId);
    const { service, razorpayProvider } = buildService();

    const result = await service.updateOrderStatus(
      orderId,
      { status: OrderStatus.CANCELLED },
      customerUser(customerId),
    );

    expect(result.status).toBe(OrderStatus.CANCELLED);
    expect(razorpayProvider.refund).toHaveBeenCalledTimes(1);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(finalOrder.paymentStatus).toBe(PaymentStatus.REFUNDED);

    const redemption = await couponsRepository.findRedemptionByOrderId(orderId);
    expect(redemption).toBeNull();
  }, 20000);
});
