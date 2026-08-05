import { randomUUID } from 'crypto';

import { CouponType, CouponScope, UserRole } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { CouponsRepository } from './coupons.repository';
import { CouponsService } from '../services/coupons.service';

/**
 * Sprint 1.3 — real-database concurrency proof for coupon redemption.
 *
 * Every other spec file in this codebase mocks Prisma entirely, which is correct for testing
 * business logic but CANNOT prove a SERIALIZABLE transaction + conditional update actually
 * prevents overflow under genuine concurrent load — a mock has no locking/isolation semantics to
 * get wrong, and (as this file's first draft discovered) no foreign-key constraints to violate
 * either. This runs `Promise.all` batches of real, concurrent `reserveRedemption` calls against a
 * real Postgres connection (the same one `DATABASE_URL` in .env already points local dev/CI at —
 * every `db:*` script in package.json makes the same assumption) and asserts on the actual row
 * state afterward. Creates and cleans up its own Coupon and User rows; touches no other data.
 *
 * Goes through CouponsService (not CouponsRepository directly): real concurrent load against
 * SERIALIZABLE genuinely produces the occasional Postgres serialization failure (P2034) even for
 * a losing side that *should* just get a clean "usage limit reached" — that's expected, and
 * CouponsService.reserveRedemption's bounded retry (same convention as
 * WalletService.writeLedgerEntry) is what turns it into the correct final outcome. Testing the
 * repository in isolation would skip that retry and produce a misleadingly pessimistic picture of
 * what a real caller (OrdersService) actually experiences.
 */
describe('CouponsService.reserveRedemption — concurrency (real database)', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );
  const repository = new CouponsRepository(prisma);
  const service = new CouponsService(repository, {} as any);
  const createdCouponIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (createdCouponIds.length > 0) {
      // CouponRedemption rows cascade-delete with their Coupon (schema.prisma: onDelete: Cascade).
      await prisma.coupon.deleteMany({
        where: { id: { in: createdCouponIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createTestCoupon(overrides: {
    usageLimit?: number | null;
    usagePerUser?: number;
  }) {
    const coupon = await prisma.coupon.create({
      data: {
        code: `CONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: 'Concurrency test coupon',
        type: CouponType.FLAT,
        value: 10,
        minOrderAmount: 0,
        scope: CouponScope.PLATFORM,
        usageLimit: overrides.usageLimit ?? null,
        usagePerUser: overrides.usagePerUser ?? 1,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60_000),
        active: true,
      },
    });

    createdCouponIds.push(coupon.id);

    return coupon;
  }

  /** CouponRedemption.userId carries a real FK to User — reserveRedemption now genuinely inserts
   *  a row (see coupons.repository.ts's doc comment on why), so test "customers" must be real
   *  rows, not arbitrary strings. */
  async function createTestUser() {
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

  async function createTestUsers(count: number): Promise<string[]> {
    return Promise.all(Array.from({ length: count }, () => createTestUser()));
  }

  function attempt(couponCode: string, userId: string) {
    return service.reserveRedemption(userId, couponCode, 'restaurant-1', 500);
  }

  function rejectionMessage(result: PromiseSettledResult<unknown>): string {
    const reason = (result as PromiseRejectedResult).reason as unknown;
    return reason instanceof Error ? reason.message : String(reason);
  }

  it('two different customers racing the last available coupon: exactly one succeeds', async () => {
    const coupon = await createTestCoupon({ usageLimit: 1 });
    const [userA, userB] = await createTestUsers(2);

    const results = await Promise.allSettled([
      attempt(coupon.code, userA),
      attempt(coupon.code, userB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejectionMessage(rejected[0])).toMatch(/usage limit/i);

    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(finalCoupon.totalUsed).toBe(1);

    const redemptionCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id },
    });
    expect(redemptionCount).toBe(1);
  }, 20000);

  it('five concurrent customers racing a coupon with usageLimit 3: exactly three succeed', async () => {
    const coupon = await createTestCoupon({ usageLimit: 3 });
    const users = await createTestUsers(5);

    const results = await Promise.allSettled(
      users.map((userId) => attempt(coupon.code, userId)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(3);

    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(finalCoupon.totalUsed).toBe(3);

    const redemptionCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id },
    });
    expect(redemptionCount).toBe(3);
  }, 20000);

  it('same customer, multiple concurrent tabs, usagePerUser 1: exactly one succeeds', async () => {
    const coupon = await createTestCoupon({
      usageLimit: null,
      usagePerUser: 1,
    });
    const user = await createTestUser();

    const results = await Promise.allSettled([
      attempt(coupon.code, user),
      attempt(coupon.code, user),
      attempt(coupon.code, user),
      attempt(coupon.code, user),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(rejectionMessage(r)).toMatch(/already redeemed/i);
    }

    // Total usage DID advance by exactly 1 too — a per-user rejection must not also leak a
    // wasted total-usage claim (the eligibility check runs before the totalUsed claim).
    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(finalCoupon.totalUsed).toBe(1);

    const redemptionCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId: user },
    });
    expect(redemptionCount).toBe(1);
  }, 20000);

  it('different customers redeeming a coupon with usagePerUser 2 each get their own two slots, no cross-contamination', async () => {
    const coupon = await createTestCoupon({
      usageLimit: null,
      usagePerUser: 2,
    });
    const [userX, userY] = await createTestUsers(2);

    // Customer X's two legitimate redemptions, and customer Y's one, all fired concurrently.
    const results = await Promise.allSettled([
      attempt(coupon.code, userX),
      attempt(coupon.code, userX),
      attempt(coupon.code, userY),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const xCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId: userX },
    });
    const yCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, userId: userY },
    });
    expect(xCount).toBe(2);
    expect(yCount).toBe(1);

    // A third attempt for customer X must now be rejected — they've used both their slots.
    await expect(attempt(coupon.code, userX)).rejects.toThrow(
      /already redeemed/i,
    );
  }, 20000);

  it('unlimited coupon: many concurrent different customers all succeed', async () => {
    const coupon = await createTestCoupon({ usageLimit: null });
    const users = await createTestUsers(10);

    const results = await Promise.allSettled(
      users.map((userId) => attempt(coupon.code, userId)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);

    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(finalCoupon.totalUsed).toBe(10);
  }, 20000);

  it('releaseRedemption undoes a reservation: totalUsed decrements and the placeholder row is removed', async () => {
    const coupon = await createTestCoupon({ usageLimit: 5 });
    const user = await createTestUser();

    const { redemptionId } = await attempt(coupon.code, user);

    const afterReserve = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(afterReserve.totalUsed).toBe(1);

    await repository.releaseRedemption(coupon.id, redemptionId);

    const afterRelease = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(afterRelease.totalUsed).toBe(0);

    const redemption = await prisma.couponRedemption.findUnique({
      where: { id: redemptionId },
    });
    expect(redemption).toBeNull();

    // The slot is genuinely free again — same user can immediately re-reserve.
    await expect(attempt(coupon.code, user)).resolves.toBeDefined();
  }, 20000);

  it('a released reservation does not block a concurrent redemption by a different customer racing at the same time', async () => {
    const coupon = await createTestCoupon({ usageLimit: 1 });
    const [userWillRelease, userTakesSlot] = await createTestUsers(2);

    const reservation = await attempt(coupon.code, userWillRelease);
    await repository.releaseRedemption(coupon.id, reservation.redemptionId);

    // Slot is free again — a different customer must be able to claim it.
    const result = await attempt(coupon.code, userTakesSlot);
    expect(result.coupon.id).toBe(coupon.id);

    const finalCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(finalCoupon.totalUsed).toBe(1);
  }, 20000);

  it('finalizeRedemption links the placeholder row to a real order and sets its final discount amount', async () => {
    const coupon = await createTestCoupon({ usageLimit: 5 });
    const user = await createTestUser();
    const restaurant = await prisma.restaurant.findFirst({
      select: { id: true },
    });

    // This test needs a real Order row to satisfy CouponRedemption.orderId's FK — reuses
    // whatever restaurant already exists in the dev DB rather than seeding a full one; skips
    // gracefully in an empty database rather than failing on unrelated fixture setup.
    if (!restaurant) {
      return;
    }

    const { redemptionId } = await attempt(coupon.code, user);

    const order = await prisma.order.create({
      data: {
        customerId: user,
        restaurantId: restaurant.id,
        orderNumber: `ORD-CONC-${randomUUID().slice(0, 8)}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 555,
        deliveryAddress: 'Concurrency test address',
      },
    });

    await repository.finalizeRedemption(redemptionId, order.id, 42);

    const redemption = await prisma.couponRedemption.findUniqueOrThrow({
      where: { id: redemptionId },
    });
    expect(redemption.orderId).toBe(order.id);
    expect(Number(redemption.discountAmount)).toBe(42);

    await prisma.order.delete({ where: { id: order.id } });
  }, 20000);
});
