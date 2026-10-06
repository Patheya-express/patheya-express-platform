import { randomUUID } from 'crypto';

import {
  OrderStatus,
  PaymentMode,
  PaymentStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { MetricsService } from '../../metrics/metrics.service';
import { OrdersRepository } from './orders.repository';

/**
 * P0-FIN-1B — real-database regression coverage for OrdersRepository.findAllForAdmin's new
 * `paymentStatus` filter (added so an operator can query e.g. status=CANCELLED&paymentStatus=PAID
 * directly — see the 2026-09 cancellation-refund review's operator-visibility finding). Mirrors
 * the real-Postgres setup pattern this codebase already uses for repository-level correctness
 * proofs (refund-integrity.concurrency.spec.ts et al.) — a mocked Prisma client could only assert
 * on the arguments passed to `findMany`, not that the resulting query actually returns the
 * correct rows. Every test scopes its assertions to a dedicated customer created for that test
 * (via the existing `customerId` filter param), so this suite is safe to run against a shared dev
 * database alongside unrelated existing data.
 */
describe('OrdersRepository.findAllForAdmin — paymentStatus filter (real database)', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );
  const ordersRepository = new OrdersRepository(prisma);

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
        'No restaurant row found in the test database — seed one before running this spec.',
      );
    }

    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createCustomer(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'AdminQuery',
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
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
    } = {},
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        orderNumber: `ORD-ADMINQ-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 565,
        deliveryAddress: 'Admin-query test address',
        paymentMode: PaymentMode.ONLINE,
        status: overrides.status ?? OrderStatus.CONFIRMED,
        paymentStatus: overrides.paymentStatus ?? PaymentStatus.PAID,
      },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  it('paymentStatus omitted: existing behavior unchanged — returns orders regardless of paymentStatus', async () => {
    const customerId = await createCustomer();
    await createOrder(customerId, { paymentStatus: PaymentStatus.PAID });
    await createOrder(customerId, { paymentStatus: PaymentStatus.PENDING });
    await createOrder(customerId, { paymentStatus: PaymentStatus.REFUNDED });

    const { items, total } = await ordersRepository.findAllForAdmin({
      skip: 0,
      take: 50,
      customerId,
    });

    expect(total).toBe(3);
    expect(items).toHaveLength(3);
  });

  it('paymentStatus=PAID returns only PAID orders', async () => {
    const customerId = await createCustomer();
    const paidId = await createOrder(customerId, {
      paymentStatus: PaymentStatus.PAID,
    });
    await createOrder(customerId, { paymentStatus: PaymentStatus.PENDING });

    const { items, total } = await ordersRepository.findAllForAdmin({
      skip: 0,
      take: 50,
      customerId,
      paymentStatus: PaymentStatus.PAID,
    });

    expect(total).toBe(1);
    expect(items.map((item) => (item as { id: string }).id)).toEqual([paidId]);
  });

  it('paymentStatus=REFUNDED returns only REFUNDED orders', async () => {
    const customerId = await createCustomer();
    await createOrder(customerId, { paymentStatus: PaymentStatus.PAID });
    const refundedId = await createOrder(customerId, {
      paymentStatus: PaymentStatus.REFUNDED,
    });

    const { items, total } = await ordersRepository.findAllForAdmin({
      skip: 0,
      take: 50,
      customerId,
      paymentStatus: PaymentStatus.REFUNDED,
    });

    expect(total).toBe(1);
    expect(items.map((item) => (item as { id: string }).id)).toEqual([
      refundedId,
    ]);
  });

  it('status=CANCELLED + paymentStatus=PAID returns only the exact intersection — this is the query P0-FIN-1B exists for', async () => {
    const customerId = await createCustomer();
    const target = await createOrder(customerId, {
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.PAID,
    });
    // Same status, different paymentStatus — must be excluded.
    await createOrder(customerId, {
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.REFUNDED,
    });
    // Same paymentStatus, different status — must be excluded.
    await createOrder(customerId, {
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
    });

    const { items, total } = await ordersRepository.findAllForAdmin({
      skip: 0,
      take: 50,
      customerId,
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.PAID,
    });

    expect(total).toBe(1);
    expect(items.map((item) => (item as { id: string }).id)).toEqual([target]);
  });

  it('pagination remains correct when combined with paymentStatus', async () => {
    const customerId = await createCustomer();
    for (let i = 0; i < 5; i += 1) {
      await createOrder(customerId, { paymentStatus: PaymentStatus.PAID });
    }
    await createOrder(customerId, { paymentStatus: PaymentStatus.PENDING });

    const pageOne = await ordersRepository.findAllForAdmin({
      skip: 0,
      take: 2,
      customerId,
      paymentStatus: PaymentStatus.PAID,
    });
    const pageTwo = await ordersRepository.findAllForAdmin({
      skip: 2,
      take: 2,
      customerId,
      paymentStatus: PaymentStatus.PAID,
    });
    const pageThree = await ordersRepository.findAllForAdmin({
      skip: 4,
      take: 2,
      customerId,
      paymentStatus: PaymentStatus.PAID,
    });

    // total reflects the full filtered set (5), independent of the current page.
    expect(pageOne.total).toBe(5);
    expect(pageTwo.total).toBe(5);
    expect(pageThree.total).toBe(5);

    expect(pageOne.items).toHaveLength(2);
    expect(pageTwo.items).toHaveLength(2);
    expect(pageThree.items).toHaveLength(1);

    // No overlap across pages, and the PENDING order never appears on any page.
    const typedItems = (items: unknown[]) => items as Array<{ id: string }>;
    const allIds = [
      ...typedItems(pageOne.items),
      ...typedItems(pageTwo.items),
      ...typedItems(pageThree.items),
    ].map((item) => item.id);
    expect(new Set(allIds).size).toBe(5);
  });
});
