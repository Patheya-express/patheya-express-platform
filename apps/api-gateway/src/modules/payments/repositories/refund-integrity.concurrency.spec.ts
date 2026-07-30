import { randomUUID } from 'crypto';

import {
  CouponScope,
  CouponType,
  PaymentProvider,
  PaymentStatus,
  TransactionStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { PaymentsRepository } from './payments.repository';
import { OrdersRepository } from '../../orders/repositories/orders.repository';
import { CouponsRepository } from '../../coupons/repositories/coupons.repository';

/**
 * Sprint 1.8 — real-database concurrency proof for refund integrity, spanning the three
 * repositories a refund actually touches (Payments, Orders, Coupons). Mirrors
 * dispatch.repository.concurrency.spec.ts (Sprint 1.7) and coupons/payments' own earlier
 * concurrency specs: every other refund-adjacent spec mocks Prisma entirely, which cannot prove
 * an advisory-lock-guarded claim or a conditional updateMany actually holds under genuine
 * concurrent load. Runs real `Promise.allSettled`/`Promise.all` batches against a real Postgres
 * connection (same `DATABASE_URL` every other concurrency spec in this codebase assumes).
 * Tested at the repository level, same reasoning as Sprint 1.7: nothing here has retry logic to
 * prove — every claim is a single conditional updateMany/transaction, so the repositories are the
 * real units under test.
 */
describe('Refund integrity — concurrency (real database)', () => {
  const prisma = new PrismaService({
    warn: () => undefined,
  } as unknown as AppLoggerService);
  const paymentsRepository = new PaymentsRepository(prisma);
  const ordersRepository = new OrdersRepository(prisma);
  const couponsRepository = new CouponsRepository(prisma);

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
        'No restaurant row found in the test database — seed one before running refund concurrency specs.',
      );
    }

    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // Payment/Refund/CouponRedemption rows cascade-delete with their Order/Payment
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

  async function createOrder(
    customerId: string,
    overrides: {
      totalAmount?: number;
      walletAmountUsed?: number;
      paymentStatus?: PaymentStatus;
    } = {},
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        orderNumber: `ORD-RCONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: overrides.totalAmount ?? 565,
        walletAmountUsed: overrides.walletAmountUsed ?? 0,
        deliveryAddress: 'Concurrency test address',
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

  // ---------------------------------------------------------------------------------------
  // PaymentsRepository.claimRefund / finalizeRefundSuccess / finalizeRefundFailure
  // ---------------------------------------------------------------------------------------

  it('two concurrent refund requests for the same payment (duplicate admin click): exactly one claims', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const results = await Promise.allSettled([
      paymentsRepository.claimRefund({ paymentId, amount: 565 }),
      paymentsRepository.claimRefund({ paymentId, amount: 565 }),
    ]);

    const claimed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.claimed,
    );
    expect(claimed).toHaveLength(1);

    const refundCount = await prisma.refund.count({ where: { paymentId } });
    expect(refundCount).toBe(1);
  }, 20000);

  it('twenty concurrent refund requests for the same payment: exactly one claims', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        paymentsRepository.claimRefund({ paymentId, amount: 565 }),
      ),
    );

    const claimed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.claimed,
    );
    expect(claimed).toHaveLength(1);

    const refundCount = await prisma.refund.count({ where: { paymentId } });
    expect(refundCount).toBe(1);
  }, 20000);

  it('duplicate browser retry (sequential): the second refundPayment-style claim after success is cleanly rejected, never a second Razorpay-eligible claim', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const first = await paymentsRepository.claimRefund({
      paymentId,
      amount: 565,
    });
    expect(first.claimed).toBe(true);
    if (!first.claimed) return;

    await paymentsRepository.finalizeRefundSuccess(paymentId, first.refund.id);

    const retry = await paymentsRepository.claimRefund({
      paymentId,
      amount: 565,
    });
    expect(retry.claimed).toBe(false);
    if (!retry.claimed) {
      expect(retry.reason).toBe('already_refunded');
    }

    const refundCount = await prisma.refund.count({ where: { paymentId } });
    expect(refundCount).toBe(1);
  }, 20000);

  it('a retry after a genuinely FAILED refund attempt can claim again cleanly', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const first = await paymentsRepository.claimRefund({
      paymentId,
      amount: 565,
    });
    expect(first.claimed).toBe(true);
    if (!first.claimed) return;

    await paymentsRepository.finalizeRefundFailure(first.refund.id);

    // Payment.status is untouched (still SUCCESS) — a retry must be able to claim again.
    const retry = await paymentsRepository.claimRefund({
      paymentId,
      amount: 565,
    });
    expect(retry.claimed).toBe(true);

    const refundCount = await prisma.refund.count({ where: { paymentId } });
    expect(refundCount).toBe(2); // one FAILED, one PENDING
  }, 20000);

  it('"webhook races refund": finalizeRefundSuccess and finalizeRefundFailure racing the same PENDING refund — exactly one outcome wins, never both', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const claim = await paymentsRepository.claimRefund({
      paymentId,
      amount: 565,
    });
    expect(claim.claimed).toBe(true);
    if (!claim.claimed) return;

    const [successResult, failureResult] = await Promise.all([
      paymentsRepository.finalizeRefundSuccess(paymentId, claim.refund.id),
      paymentsRepository.finalizeRefundFailure(claim.refund.id),
    ]);

    // finalizeRefundSuccess's refund-claim count and finalizeRefundFailure's count can't both be 1.
    const successWon = successResult.refundClaimCount === 1;
    const failureWon = failureResult.count === 1;
    expect(successWon !== failureWon).toBe(true);

    const finalRefund = await prisma.refund.findUniqueOrThrow({
      where: { id: claim.refund.id },
    });
    expect([TransactionStatus.REFUNDED, TransactionStatus.FAILED]).toContain(
      finalRefund.status,
    );

    const finalPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    // Payment.status must agree with whichever side actually won — never REFUNDED if the refund
    // row itself ended up FAILED (a corrupted "payment says refunded, refund row says it wasn't"
    // mixed state is exactly what this test guards against).
    if (finalRefund.status === TransactionStatus.REFUNDED) {
      expect(finalPayment.status).toBe(TransactionStatus.REFUNDED);
    } else {
      expect(finalPayment.status).toBe(TransactionStatus.SUCCESS);
    }
  }, 20000);

  it('already-refunded payment: claimRefund rejects a further attempt', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const claim = await paymentsRepository.claimRefund({
      paymentId,
      amount: 565,
    });
    expect(claim.claimed).toBe(true);
    if (!claim.claimed) return;
    await paymentsRepository.finalizeRefundSuccess(paymentId, claim.refund.id);

    const second = await paymentsRepository.claimRefund({
      paymentId,
      amount: 100,
    });
    expect(second.claimed).toBe(false);
    if (!second.claimed) {
      expect(second.reason).toBe('already_refunded');
    }
  }, 20000);

  it('invalid refund amount (zero/negative) is rejected before any claim is made', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId);

    const zero = await paymentsRepository.claimRefund({ paymentId, amount: 0 });
    const negative = await paymentsRepository.claimRefund({
      paymentId,
      amount: -50,
    });

    expect(zero.claimed).toBe(false);
    expect(negative.claimed).toBe(false);
    if (!zero.claimed) expect(zero.reason).toBe('invalid_amount');
    if (!negative.claimed) expect(negative.reason).toBe('invalid_amount');

    const refundCount = await prisma.refund.count({ where: { paymentId } });
    expect(refundCount).toBe(0);
  }, 20000);

  it('refund amount exceeding the payment amount is rejected', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId, 565);

    const result = await paymentsRepository.claimRefund({
      paymentId,
      amount: 1000,
    });
    expect(result.claimed).toBe(false);
    if (!result.claimed) {
      expect(result.reason).toBe('invalid_amount');
    }
  }, 20000);

  it('partial refund is claimable once, but a second attempt (even for the remaining balance) is safely rejected — this state machine has no incremental multi-partial-refund concept', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);
    const paymentId = await createSuccessfulPayment(orderId, 565);

    const partial = await paymentsRepository.claimRefund({
      paymentId,
      amount: 200,
    });
    expect(partial.claimed).toBe(true);
    if (!partial.claimed) return;
    await paymentsRepository.finalizeRefundSuccess(
      paymentId,
      partial.refund.id,
    );

    const secondPartial = await paymentsRepository.claimRefund({
      paymentId,
      amount: 365, // the "remaining" balance
    });
    expect(secondPartial.claimed).toBe(false);
    if (!secondPartial.claimed) {
      expect(secondPartial.reason).toBe('already_refunded');
    }

    const finalPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(finalPayment.status).toBe(TransactionStatus.REFUNDED);
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // OrdersRepository.claimPaymentStatusTransition — the order-level exactly-once gate
  // ---------------------------------------------------------------------------------------

  it('"duplicate admin click" / "cancel races refund" at the order level: two concurrent order-level refund claims — exactly one wins', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer, {
      paymentStatus: PaymentStatus.PAID,
    });

    const results = await Promise.all([
      ordersRepository.claimPaymentStatusTransition(
        orderId,
        [PaymentStatus.PAID],
        PaymentStatus.REFUNDED,
      ),
      ordersRepository.claimPaymentStatusTransition(
        orderId,
        [PaymentStatus.PAID],
        PaymentStatus.REFUNDED,
      ),
    ]);

    const winners = results.filter((r) => r.count === 1);
    expect(winners).toHaveLength(1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.paymentStatus).toBe(PaymentStatus.REFUNDED);
  }, 20000);

  it('"wallet refund races payment update": since wallet-crediting is only ever triggered by the winner of the order-level claim, twenty concurrent refund attempts for the same order still only produce one winner (transitively, at most one wallet-credit publish)', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer, {
      paymentStatus: PaymentStatus.PAID,
      totalAmount: 565,
      walletAmountUsed: 100,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        ordersRepository.claimPaymentStatusTransition(
          orderId,
          [PaymentStatus.PAID],
          PaymentStatus.REFUNDED,
        ),
      ),
    );

    const winners = results.filter(
      (r) => r.status === 'fulfilled' && r.value.count === 1,
    );
    expect(winners).toHaveLength(1);
  }, 20000);

  it('the order-level claim reverts cleanly (REFUNDED→PAID) so a failed refund attempt leaves the order retryable', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer, {
      paymentStatus: PaymentStatus.PAID,
    });

    const claim = await ordersRepository.claimPaymentStatusTransition(
      orderId,
      [PaymentStatus.PAID],
      PaymentStatus.REFUNDED,
    );
    expect(claim.count).toBe(1);

    // Simulates OrdersService.refundOrder's catch-block compensation after refundPayment throws.
    const revert = await ordersRepository.claimPaymentStatusTransition(
      orderId,
      [PaymentStatus.REFUNDED],
      PaymentStatus.PAID,
    );
    expect(revert.count).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);

    // Now retryable — a fresh claim succeeds.
    const retryClaim = await ordersRepository.claimPaymentStatusTransition(
      orderId,
      [PaymentStatus.PAID],
      PaymentStatus.REFUNDED,
    );
    expect(retryClaim.count).toBe(1);
  }, 20000);

  // ---------------------------------------------------------------------------------------
  // CouponsRepository.releaseRedemption — "coupon release races refund"
  // ---------------------------------------------------------------------------------------

  async function createRedeemedCoupon(): Promise<{
    couponId: string;
    redemptionId: string;
    orderId: string;
  }> {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);

    const coupon = await prisma.coupon.create({
      data: {
        code: `RCONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Refund concurrency test coupon',
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
        userId: customer,
        orderId,
        discountAmount: 10,
      },
    });

    return { couponId: coupon.id, redemptionId: redemption.id, orderId };
  }

  it('coupon release races refund: two concurrent release attempts for the same redemption — exactly one succeeds, totalUsed decrements exactly once', async () => {
    const { couponId, redemptionId } = await createRedeemedCoupon();

    const results = await Promise.allSettled([
      couponsRepository.releaseRedemption(couponId, redemptionId),
      couponsRepository.releaseRedemption(couponId, redemptionId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: couponId },
    });
    expect(finalCoupon.totalUsed).toBe(0);

    const redemption = await prisma.couponRedemption.findUnique({
      where: { id: redemptionId },
    });
    expect(redemption).toBeNull();
  }, 20000);

  it('a redeemed order with no coupon: releaseForOrder-equivalent lookup finds nothing and is a clean no-op', async () => {
    const customer = await createCustomer();
    const orderId = await createOrder(customer);

    const redemption = await couponsRepository.findRedemptionByOrderId(orderId);
    expect(redemption).toBeNull();
  }, 20000);
});
