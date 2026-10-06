import { randomUUID } from 'crypto';

import { PaymentProvider, TransactionStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { MetricsService } from '../../metrics/metrics.service';

/**
 * P0-CASCADE-3 — real-database proof that the seven financial/audit/dispatch-history/
 * delivery-evidence Order-subtree relations identified in P0-CASCADE-1/2 are now genuinely
 * protected at the database level (onDelete: Restrict), and that the three relations explicitly
 * left unchanged (CouponRedemption.order, OrderItem.order, DeliveryProofOtp.order) still cascade
 * exactly as before. Mirrors this codebase's existing real-Postgres concurrency-spec pattern —
 * mocked Prisma cannot prove a FK constraint actually rejects a delete, since a mock has no
 * referential-integrity semantics to get wrong.
 *
 * Every fixture is deliberately minimal and independently created/torn down per test (rather than
 * shared), since a failed DELETE inside a test must leave every row — parent and child — exactly
 * as it was, and the next test must not depend on that state.
 */
describe('Order financial/audit-trail FK retention (real database) — P0-CASCADE-3', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdRestaurantIds: string[] = [];

  let seedRestaurantId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const restaurant = await prisma.restaurant.findFirst({
      select: { id: true },
    });

    if (!restaurant) {
      throw new Error(
        'No restaurant row found in the test database — seed one before running this spec.',
      );
    }

    seedRestaurantId = restaurant.id;
  });

  afterAll(async () => {
    // Dependency-respecting cleanup under the new RESTRICT constraints: refunds -> payments ->
    // (order-status-history / delivery-assignments / delivery-proof-photos / delivery-proof-otps
    // / order-items / coupon-redemptions all cascade automatically) -> orders -> restaurants ->
    // users. Every test below is expected to leave its fixture intact (the delete it attempts
    // must fail), so this is what actually removes the data.
    if (createdOrderIds.length > 0) {
      await prisma.refund.deleteMany({
        where: { payment: { orderId: { in: createdOrderIds } } },
      });
      await prisma.payment.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.deliveryAssignment.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.deliveryProofPhoto.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdRestaurantIds.length > 0) {
      await prisma.restaurant.deleteMany({
        where: { id: { in: createdRestaurantIds } },
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
        firstName: 'Retention',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createRestaurantWithOwner(): Promise<{
    ownerId: string;
    restaurantId: string;
  }> {
    const owner = await prisma.user.create({
      data: {
        firstName: 'Retention',
        lastName: 'Owner',
        role: UserRole.RESTAURANT_OWNER,
      },
    });
    createdUserIds.push(owner.id);

    const restaurant = await prisma.restaurant.create({
      data: {
        ownerId: owner.id,
        name: 'Retention Test Restaurant',
        slug: `retention-test-${randomUUID().slice(0, 8)}`,
      },
    });
    createdRestaurantIds.push(restaurant.id);

    return { ownerId: owner.id, restaurantId: restaurant.id };
  }

  async function createOrder(
    customerId: string,
    restaurantId: string,
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        orderNumber: `ORD-RETAIN-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 565,
        deliveryAddress: 'Retention test address',
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  async function createPayment(orderId: string, amount = 565): Promise<string> {
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

  /** Asserts a Prisma delete rejects with the Postgres FK-violation error code (P2003) — the
   *  actual, real database enforcing the new RESTRICT constraint, not a simulated rejection. */
  async function expectForeignKeyRestriction(
    operation: () => Promise<unknown>,
  ): Promise<void> {
    await expect(operation()).rejects.toMatchObject(
      expect.objectContaining({ code: 'P2003' }),
    );
  }

  it('TEST 1: deleting a User with an existing customer Order is rejected', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, seedRestaurantId);

    await expectForeignKeyRestriction(() =>
      prisma.user.delete({ where: { id: customerId } }),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: customerId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
  });

  it('TEST 2: deleting a Restaurant with an existing Order is rejected', async () => {
    const customerId = await createCustomer();
    const { restaurantId } = await createRestaurantWithOwner();
    const orderId = await createOrder(customerId, restaurantId);

    await expectForeignKeyRestriction(() =>
      prisma.restaurant.delete({ where: { id: restaurantId } }),
    );

    await expect(
      prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
  });

  it('TEST 3: deleting the owner User of a Restaurant that has Orders is rejected (transitive User -> Restaurant -> Order protection)', async () => {
    const customerId = await createCustomer();
    const { ownerId, restaurantId } = await createRestaurantWithOwner();
    const orderId = await createOrder(customerId, restaurantId);

    // The Restaurant.owner edge to User is still CASCADE (out of scope for this migration) — it's
    // the Order.restaurant RESTRICT that must block this delete, transitively, since Postgres
    // evaluates the whole cascading DELETE as one statement/transaction and rolls back entirely
    // if any leg is restricted.
    await expectForeignKeyRestriction(() =>
      prisma.user.delete({ where: { id: ownerId } }),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: ownerId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
  });

  it('TEST 4: deleting an Order with an existing Payment is rejected', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, seedRestaurantId);
    const paymentId = await createPayment(orderId);

    await expectForeignKeyRestriction(() =>
      prisma.order.delete({ where: { id: orderId } }),
    );

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    ).resolves.toBeDefined();
  });

  it('TEST 5: deleting a Payment with an existing Refund is rejected', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, seedRestaurantId);
    const paymentId = await createPayment(orderId);
    const refund = await prisma.refund.create({
      data: { paymentId, amount: 565, status: TransactionStatus.PENDING },
    });

    await expectForeignKeyRestriction(() =>
      prisma.payment.delete({ where: { id: paymentId } }),
    );

    await expect(
      prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
    ).resolves.toBeDefined();
  });

  it('TEST 6: deleting an Order with OrderStatusHistory is rejected', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, seedRestaurantId);
    const history = await prisma.orderStatusHistory.create({
      data: { orderId, status: 'CONFIRMED' },
    });

    await expectForeignKeyRestriction(() =>
      prisma.order.delete({ where: { id: orderId } }),
    );

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.orderStatusHistory.findUniqueOrThrow({
        where: { id: history.id },
      }),
    ).resolves.toBeDefined();
  });

  it('TEST 7: deleting an Order with a DeliveryAssignment is rejected', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, seedRestaurantId);

    const partnerUser = await prisma.user.create({
      data: {
        firstName: 'Retention',
        lastName: 'Partner',
        role: UserRole.DELIVERY_PARTNER,
      },
    });
    createdUserIds.push(partnerUser.id);

    const deliveryPartner = await prisma.deliveryPartner.create({
      data: {
        userId: partnerUser.id,
        vehicleType: 'BIKE',
        vehicleNumber: `RT-${randomUUID().slice(0, 6).toUpperCase()}`,
      },
    });

    const assignment = await prisma.deliveryAssignment.create({
      data: { orderId, deliveryPartnerId: deliveryPartner.id },
    });

    await expectForeignKeyRestriction(() =>
      prisma.order.delete({ where: { id: orderId } }),
    );

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.deliveryAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      }),
    ).resolves.toBeDefined();
  });

  it('TEST 8: deleting an Order with a DeliveryProofPhoto is rejected', async () => {
    const customerId = await createCustomer();
    const orderId = await createOrder(customerId, seedRestaurantId);
    const photo = await prisma.deliveryProofPhoto.create({
      data: {
        orderId,
        type: 'PICKUP',
        storageUrl: 'https://example.test/retention-fixture.jpg',
        fileName: 'retention-fixture.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedById: customerId,
      },
    });

    await expectForeignKeyRestriction(() =>
      prisma.order.delete({ where: { id: orderId } }),
    );

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.deliveryProofPhoto.findUniqueOrThrow({ where: { id: photo.id } }),
    ).resolves.toBeDefined();
  });

  describe('unchanged relations remain CASCADE (scope guard — this migration must not broaden)', () => {
    it('CouponRedemption.order still cascades: deleting an Order with a CouponRedemption succeeds and removes the redemption', async () => {
      const customerId = await createCustomer();
      const orderId = await createOrder(customerId, seedRestaurantId);

      const coupon = await prisma.coupon.create({
        data: {
          code: `RETAIN-${randomUUID().slice(0, 8).toUpperCase()}`,
          name: 'Retention scope-guard coupon',
          type: 'FLAT',
          value: 10,
          minOrderAmount: 0,
          scope: 'PLATFORM',
          usagePerUser: 1,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 60_000),
          active: true,
        },
      });
      const redemption = await prisma.couponRedemption.create({
        data: {
          couponId: coupon.id,
          userId: customerId,
          orderId,
          discountAmount: 10,
        },
      });

      await prisma.order.delete({ where: { id: orderId } });
      createdOrderIds.splice(createdOrderIds.indexOf(orderId), 1); // already gone — don't double-delete in afterAll

      await expect(
        prisma.couponRedemption.findUnique({ where: { id: redemption.id } }),
      ).resolves.toBeNull();
      await expect(
        prisma.order.findUnique({ where: { id: orderId } }),
      ).resolves.toBeNull();

      await prisma.coupon.delete({ where: { id: coupon.id } });
    });

    it('OrderItem.order still cascades: deleting an Order with an OrderItem succeeds and removes the item', async () => {
      const customerId = await createCustomer();
      const orderId = await createOrder(customerId, seedRestaurantId);

      const category = await prisma.menuCategory.create({
        data: {
          restaurantId: seedRestaurantId,
          name: `Retention ${randomUUID().slice(0, 6)}`,
        },
      });
      const menuItem = await prisma.menuItem.create({
        data: {
          categoryId: category.id,
          name: 'Retention scope-guard item',
          basePrice: 100,
        },
      });
      const orderItem = await prisma.orderItem.create({
        data: {
          orderId,
          menuItemId: menuItem.id,
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
        },
      });

      await prisma.order.delete({ where: { id: orderId } });
      createdOrderIds.splice(createdOrderIds.indexOf(orderId), 1);

      await expect(
        prisma.orderItem.findUnique({ where: { id: orderItem.id } }),
      ).resolves.toBeNull();

      await prisma.menuItem.delete({ where: { id: menuItem.id } });
      await prisma.menuCategory.delete({ where: { id: category.id } });
    });

    it('DeliveryProofOtp.order still cascades: deleting an Order with a DeliveryProofOtp succeeds and removes the OTP row', async () => {
      const customerId = await createCustomer();
      const orderId = await createOrder(customerId, seedRestaurantId);

      const otp = await prisma.deliveryProofOtp.create({
        data: {
          orderId,
          type: 'PICKUP',
          otpHash: 'retention-scope-guard-hash',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await prisma.order.delete({ where: { id: orderId } });
      createdOrderIds.splice(createdOrderIds.indexOf(orderId), 1);

      await expect(
        prisma.deliveryProofOtp.findUnique({ where: { id: otp.id } }),
      ).resolves.toBeNull();
    });
  });
});
