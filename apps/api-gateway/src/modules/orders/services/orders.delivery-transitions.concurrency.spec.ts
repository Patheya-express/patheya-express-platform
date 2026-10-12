import { randomUUID } from 'crypto';

import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { CouponsRepository } from '../../coupons/repositories/coupons.repository';
import { CouponsService } from '../../coupons/services/coupons.service';
import { OrdersRepository } from '../repositories/orders.repository';
import { OrdersService } from './orders.service';
import type { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

/**
 * 2026-10-12 — real-database proof that OrdersService order-status transitions are
 * compare-and-set (OrdersRepository.transitionStatusIfCurrent) on the delivery path: duplicate
 * pickup/delivery confirmations, pickup or delivery racing an admin cancellation, and a stale
 * writer overwriting a newer status. Mirrors orders.cancellation-refund.concurrency.spec.ts:
 * real concurrent `Promise.allSettled` batches against a real Postgres, asserting on actual rows.
 * Orders are unpaid COD so admin cancellation never enters the refund path (covered separately).
 * The photo and OTP gates are exercised with real DeliveryProofPhoto / DeliveryProofOtp rows.
 */
describe('OrdersService delivery transitions — compare-and-set concurrency (real database)', () => {
  const prisma = new PrismaService(
    { warn: () => undefined } as unknown as AppLoggerService,
    {} as unknown as MetricsService,
  );
  const ordersRepository = new OrdersRepository(prisma);
  const couponsService = new CouponsService(
    new CouponsRepository(prisma),
    {} as never,
  );

  const fakeLogger = {
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
  } as unknown as AppLoggerService;

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
        'No restaurant row found in the test database — seed one before running delivery transition concurrency specs.',
      );
    }

    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // DeliveryProofPhoto and OrderStatusHistory are onDelete: Restrict (P0-CASCADE-3) —
      // delete them before their Order. DeliveryProofOtp still cascades.
      await prisma.deliveryProofPhoto.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createUser(role: UserRole): Promise<string> {
    const user = await prisma.user.create({
      data: { firstName: 'Transition', lastName: 'Concurrency', role },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createOrder(
    status: OrderStatus,
  ): Promise<{ orderId: string; riderId: string; adminId: string }> {
    const customerId = await createUser(UserRole.CUSTOMER);
    const riderId = await createUser(UserRole.DELIVERY_PARTNER);
    const adminId = await createUser(UserRole.ADMIN);

    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        deliveryPartnerId: riderId,
        orderNumber: `ORD-TXCONC-${randomUUID().slice(0, 8).toUpperCase()}`,
        subtotalAmount: 500,
        deliveryFee: 40,
        taxAmount: 25,
        totalAmount: 565,
        deliveryAddress: 'Transition concurrency test address',
        status,
        paymentMode: PaymentMode.COD,
        paymentStatus: PaymentStatus.PENDING,
      },
    });
    createdOrderIds.push(order.id);

    return { orderId: order.id, riderId, adminId };
  }

  async function addPickupPhoto(orderId: string, riderId: string) {
    await prisma.deliveryProofPhoto.create({
      data: {
        orderId,
        type: DeliveryProofType.PICKUP,
        storageUrl: 'https://example.invalid/parcel.jpg',
        fileName: 'parcel.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedById: riderId,
      },
    });
  }

  async function addVerifiedDeliveryOtp(orderId: string) {
    await prisma.deliveryProofOtp.create({
      data: {
        orderId,
        type: DeliveryProofType.DELIVERY,
        otpHash: 'not-a-real-hash',
        expiresAt: new Date(Date.now() + 600_000),
        maxAttempts: 5,
        status: DeliveryProofOtpStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
  }

  function buildService() {
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const realtimeService = { emitToOrder: jest.fn() };
    const deliveryService = {
      releasePartnerFromDelivery: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrdersService(
      prisma,
      ordersRepository,
      eventBus as never,
      deliveryService as never,
      {} as never, // paymentsService — unpaid COD orders never reach the refund path
      // restaurantsService — DELIVERED feeds fulfilment timing back to the restaurant.
      { recordOrderTiming: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never, // addressesService
      realtimeService as never,
      {} as never, // queueService
      {} as never, // redisService
      { log: jest.fn().mockResolvedValue(undefined) } as never, // auditService
      fakeLogger,
      {} as never, // pricingEngineService
      couponsService,
    );

    return { service, eventBus, realtimeService, deliveryService };
  }

  const rider = (userId: string): AuthenticatedUser => ({
    userId,
    role: UserRole.DELIVERY_PARTNER,
  });

  function rejectionsAreStaleTransitions(
    results: PromiseSettledResult<unknown>[],
  ): boolean {
    return results.every(
      (result) =>
        result.status === 'fulfilled' ||
        result.reason instanceof ConflictException ||
        result.reason instanceof BadRequestException,
    );
  }

  async function historyStatuses(orderId: string): Promise<OrderStatus[]> {
    const rows = await prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.status);
  }

  it('two concurrent pickup confirmations: exactly one succeeds, one history row, one event', async () => {
    const { orderId, riderId } = await createOrder(
      OrderStatus.READY_FOR_PICKUP,
    );
    await addPickupPhoto(orderId, riderId);
    const { service, eventBus } = buildService();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.updateOrderStatus(
          orderId,
          { status: OrderStatus.OUT_FOR_DELIVERY },
          rider(riderId),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejectionsAreStaleTransitions(results)).toBe(true);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe(OrderStatus.OUT_FOR_DELIVERY);
    expect(await historyStatuses(orderId)).toEqual([
      OrderStatus.OUT_FOR_DELIVERY,
    ]);
    expect(
      eventBus.publish.mock.calls.filter(
        ([name]) => name === 'order.status.changed',
      ),
    ).toHaveLength(1);
  }, 20000);

  it('pickup without the parcel photo is refused and leaves the order untouched', async () => {
    const { orderId, riderId } = await createOrder(
      OrderStatus.READY_FOR_PICKUP,
    );
    const { service } = buildService();

    await expect(
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.OUT_FOR_DELIVERY },
        rider(riderId),
      ),
    ).rejects.toThrow(/pickup photo is required/);

    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe(OrderStatus.READY_FOR_PICKUP);
    expect(await historyStatuses(orderId)).toEqual([]);
  }, 20000);

  it('pickup racing an admin cancellation: exactly one outcome, recorded once, never overwritten', async () => {
    const { orderId, riderId, adminId } = await createOrder(
      OrderStatus.READY_FOR_PICKUP,
    );
    await addPickupPhoto(orderId, riderId);
    const { service } = buildService();

    const results = await Promise.allSettled([
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.OUT_FOR_DELIVERY },
        rider(riderId),
      ),
      service.adminCancelOrder(orderId, { reason: 'race test' }, adminId),
    ]);

    expect(rejectionsAreStaleTransitions(results)).toBe(true);

    const finalStatus = (
      await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    ).status;
    const history = await historyStatuses(orderId);

    // Admin cancel is allowed from any non-terminal status, so "pickup then cancel" in sequence
    // is legitimate. What must never happen is a write landing on a status it didn't validate
    // against: the final status must be the last recorded transition, and pickup must never be
    // recorded after a cancellation.
    expect(history[history.length - 1]).toBe(finalStatus);
    expect(history).not.toEqual([
      OrderStatus.CANCELLED,
      OrderStatus.OUT_FOR_DELIVERY,
    ]);
    expect(new Set(history).size).toBe(history.length);
  }, 20000);

  it('delivery completion racing an admin cancellation: a delivered order is never turned into CANCELLED', async () => {
    const { orderId, riderId, adminId } = await createOrder(
      OrderStatus.OUT_FOR_DELIVERY,
    );
    await addVerifiedDeliveryOtp(orderId);
    const { service } = buildService();

    const results = await Promise.allSettled([
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.DELIVERED },
        rider(riderId),
      ),
      service.adminCancelOrder(orderId, { reason: 'race test' }, adminId),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejectionsAreStaleTransitions(results)).toBe(true);

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(await historyStatuses(orderId)).toEqual([finalOrder.status]);

    if (finalOrder.status === OrderStatus.DELIVERED) {
      expect(finalOrder.deliveredAt).not.toBeNull();
    } else {
      expect(finalOrder.status).toBe(OrderStatus.CANCELLED);
      expect(finalOrder.deliveredAt).toBeNull();
    }
  }, 20000);

  it('duplicate delivery completion: delivered once, released once', async () => {
    const { orderId, riderId } = await createOrder(
      OrderStatus.OUT_FOR_DELIVERY,
    );
    await addVerifiedDeliveryOtp(orderId);
    const { service, deliveryService } = buildService();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.updateOrderStatus(
          orderId,
          { status: OrderStatus.DELIVERED },
          rider(riderId),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejectionsAreStaleTransitions(results)).toBe(true);
    expect(await historyStatuses(orderId)).toEqual([OrderStatus.DELIVERED]);
    expect(deliveryService.releasePartnerFromDelivery).toHaveBeenCalledTimes(1);
  }, 20000);

  it('delivery completion without a verified delivery OTP is refused', async () => {
    const { orderId, riderId } = await createOrder(
      OrderStatus.OUT_FOR_DELIVERY,
    );
    const { service } = buildService();

    await expect(
      service.updateOrderStatus(
        orderId,
        { status: OrderStatus.DELIVERED },
        rider(riderId),
      ),
    ).rejects.toThrow(/verified delivery OTP is required/);

    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe(OrderStatus.OUT_FOR_DELIVERY);
  }, 20000);

  it('a stale writer cannot overwrite a newer status', async () => {
    const { orderId } = await createOrder(OrderStatus.DELIVERED);

    const result = await ordersRepository.transitionStatusIfCurrent(
      orderId,
      OrderStatus.OUT_FOR_DELIVERY, // what a stale caller last saw
      OrderStatus.CANCELLED,
    );

    expect(result).toBeNull();
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status,
    ).toBe(OrderStatus.DELIVERED);
  }, 20000);
});
