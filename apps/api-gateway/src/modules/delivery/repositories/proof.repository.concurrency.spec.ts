import { randomUUID } from 'crypto';

import {
  DeliveryProofOtpStatus,
  DeliveryProofType,
  OrderStatus,
  PaymentMode,
  PaymentStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { ProofRepository } from './proof.repository';

/**
 * 2026-10-12 — real-database proof for the delivery OTP's conditional writes: issueOtp (resend
 * cooldown, per-order issue cap, verified-is-final), recordFailedAttempt (attempt cap under
 * concurrent wrong guesses) and markVerifiedIfPending (single-use verification). These are
 * single conditional UPDATEs whose correctness depends on real row locking, which a Prisma mock
 * can't exercise — same reasoning as dispatch.repository.concurrency.spec.ts.
 */
describe('ProofRepository — delivery OTP concurrency (real database)', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );
  const repository = new ProofRepository(prisma);

  const LIMITS = { cooldownMs: 60_000, maxGenerations: 5 };
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  let restaurantId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const restaurant = await prisma.restaurant.findFirst({
      select: { id: true },
    });

    if (!restaurant) {
      throw new Error(
        'No restaurant row found in the test database — seed one before running OTP concurrency specs.',
      );
    }

    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // DeliveryProofOtp cascades with its Order.
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createOrder(): Promise<string> {
    const customer = await prisma.user.create({
      data: {
        firstName: 'Otp',
        lastName: 'Concurrency',
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(customer.id);

    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        restaurantId,
        orderNumber: `ORD-OTPCONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 565,
        deliveryAddress: 'OTP concurrency test address',
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentMode: PaymentMode.COD,
        paymentStatus: PaymentStatus.PENDING,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  function issue(orderId: string, limits = LIMITS) {
    return repository.issueOtp({
      orderId,
      type: DeliveryProofType.DELIVERY,
      otpHash: `hash-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 600_000),
      maxAttempts: 5,
      limits,
    });
  }

  /** Moves the last issue time into the past, as if the cooldown had elapsed. */
  async function ageLastIssue(orderId: string, msAgo: number) {
    await prisma.deliveryProofOtp.update({
      where: {
        orderId_type: { orderId, type: DeliveryProofType.DELIVERY },
      },
      data: { lastGeneratedAt: new Date(Date.now() - msAgo) },
    });
  }

  it('ten concurrent first requests issue exactly one code', async () => {
    const orderId = await createOrder();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => issue(orderId)),
    );

    expect(results.filter((r) => r.issued)).toHaveLength(1);
    expect(
      results
        .filter((r) => !r.issued)
        .every((r) => !r.issued && r.reason === 'cooldown'),
    ).toBe(true);

    const row = await repository.findOtp(orderId, DeliveryProofType.DELIVERY);
    expect(row?.generationCount).toBe(1);
  }, 20000);

  it('ten concurrent resends after the cooldown issue exactly one more code', async () => {
    const orderId = await createOrder();
    await issue(orderId);
    await ageLastIssue(orderId, 61_000);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => issue(orderId)),
    );

    expect(results.filter((r) => r.issued)).toHaveLength(1);
    const row = await repository.findOtp(orderId, DeliveryProofType.DELIVERY);
    expect(row?.generationCount).toBe(2);
  }, 20000);

  it('refuses a resend inside the cooldown and leaves the current code untouched', async () => {
    const orderId = await createOrder();
    const first = await issue(orderId);
    const before = await repository.findOtp(
      orderId,
      DeliveryProofType.DELIVERY,
    );

    const second = await issue(orderId);

    expect(first.issued).toBe(true);
    expect(second).toMatchObject({ issued: false, reason: 'cooldown' });
    const after = await repository.findOtp(orderId, DeliveryProofType.DELIVERY);
    expect(after?.otpHash).toBe(before?.otpHash);
  }, 20000);

  it('stops at the per-order cap even after the cooldown', async () => {
    const orderId = await createOrder();
    for (let i = 0; i < LIMITS.maxGenerations; i++) {
      await ageLastIssue(orderId, 61_000).catch(() => undefined);
      expect((await issue(orderId)).issued).toBe(true);
    }
    await ageLastIssue(orderId, 61_000);

    const refused = await issue(orderId);

    expect(refused).toMatchObject({ issued: false, reason: 'limit' });
    const row = await repository.findOtp(orderId, DeliveryProofType.DELIVERY);
    expect(row?.generationCount).toBe(LIMITS.maxGenerations);
  }, 20000);

  it('never replaces a verified code, with or without limits', async () => {
    const orderId = await createOrder();
    const issued = await issue(orderId);
    if (!issued.issued) throw new Error('fixture: first issue must succeed');
    expect(await repository.markVerifiedIfPending(issued.otp.id)).toBe(true);
    await ageLastIssue(orderId, 61_000);

    expect(await issue(orderId)).toMatchObject({
      issued: false,
      reason: 'verified',
    });
    expect(await issue(orderId, undefined)).toMatchObject({
      issued: false,
      reason: 'verified',
    });
    const row = await repository.findOtp(orderId, DeliveryProofType.DELIVERY);
    expect(row?.status).toBe(DeliveryProofOtpStatus.VERIFIED);
  }, 20000);

  it('twenty concurrent wrong guesses never exceed the attempt cap and end EXCEEDED', async () => {
    const orderId = await createOrder();
    const issued = await issue(orderId);
    if (!issued.issued) throw new Error('fixture: first issue must succeed');

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repository.recordFailedAttempt(issued.otp.id, 5),
      ),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(5);
    const row = await repository.findOtp(orderId, DeliveryProofType.DELIVERY);
    expect(row?.attempts).toBe(5);
    expect(row?.status).toBe(DeliveryProofOtpStatus.EXCEEDED);
  }, 20000);

  it('ten concurrent correct submissions verify exactly once (single use)', async () => {
    const orderId = await createOrder();
    const issued = await issue(orderId);
    if (!issued.issued) throw new Error('fixture: first issue must succeed');

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.markVerifiedIfPending(issued.otp.id),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    // A replay after success is refused too.
    expect(await repository.markVerifiedIfPending(issued.otp.id)).toBe(false);
  }, 20000);

  it('a code is scoped to its own order', async () => {
    const orderA = await createOrder();
    const orderB = await createOrder();
    await issue(orderA);

    expect(
      await repository.findOtp(orderB, DeliveryProofType.DELIVERY),
    ).toBeNull();
  }, 20000);
});
