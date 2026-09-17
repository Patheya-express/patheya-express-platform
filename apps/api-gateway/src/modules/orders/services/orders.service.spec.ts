import { ConflictException } from '@nestjs/common';
import { Prisma, PaymentMode } from '@prisma/client';

import { OrdersService } from './orders.service';
import type { CreateOrderDto } from '../dto/create-order.dto';

/**
 * Enterprise order idempotency (Sprint 1.2) — regression coverage for OrdersService.placeOrder's
 * idempotency wrapper: the fast-path replay lookup, the Redis advisory lock (and its fail-open
 * behavior when Redis is unavailable), and the DB-unique-constraint race-loss handling around
 * createOrder(). Only the true I/O boundaries (Prisma, RedisService, EventBusService,
 * QueueService, CouponsService) are mocked — the idempotency control flow itself runs as real,
 * unmodified production code.
 */

function buildMenuItem(overrides: Partial<any> = {}) {
  return {
    id: 'menu-item-1',
    name: 'Veg Burger',
    basePrice: 199,
    category: { restaurantId: 'restaurant-1' },
    variants: [],
    addons: [],
    ...overrides,
  };
}

function buildDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    restaurantId: 'restaurant-1',
    deliveryAddress: '123 Test Street',
    paymentMode: PaymentMode.ONLINE,
    items: [{ menuItemId: 'menu-item-1', quantity: 2 }],
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    items: [],
    ...overrides,
  };
}

function buildPricing(overrides: Partial<any> = {}) {
  return {
    subtotal: 398,
    deliveryFee: 40,
    taxAmount: 19.9,
    discountAmount: 0,
    totalAmount: 457.9,
    ...overrides,
  };
}

/** Mimics a real Postgres unique-constraint violation on (customerId, idempotencyKey). */
function buildUniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`customerId`,`idempotencyKey`)',
    { code: 'P2002', clientVersion: 'test' },
  );
}

describe('OrdersService.placeOrder — idempotency', () => {
  let service: OrdersService;
  let prisma: {
    menuItem: { findMany: jest.Mock };
    restaurantSettings: { findUnique: jest.Mock };
  };
  let ordersRepository: {
    createOrder: jest.Mock;
    findOrderByIdempotencyKey: jest.Mock;
    createStatusHistory: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let addressesService: { findByIdForCustomer: jest.Mock };
  let queueService: { addOrderAcceptanceTimeoutJob: jest.Mock };
  let redisService: { tryLock: jest.Mock; releaseLock: jest.Mock };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let pricingEngineService: { calculate: jest.Mock };
  let couponsService: {
    reserveRedemption: jest.Mock;
    releaseRedemption: jest.Mock;
    finalizeRedemption: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      menuItem: { findMany: jest.fn().mockResolvedValue([buildMenuItem()]) },
      restaurantSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    ordersRepository = {
      createOrder: jest.fn().mockResolvedValue(buildOrder()),
      findOrderByIdempotencyKey: jest.fn().mockResolvedValue(null),
      createStatusHistory: jest.fn().mockResolvedValue(undefined),
    };

    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    addressesService = { findByIdForCustomer: jest.fn() };
    queueService = {
      addOrderAcceptanceTimeoutJob: jest.fn().mockResolvedValue(undefined),
    };
    redisService = {
      tryLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    pricingEngineService = {
      calculate: jest.fn().mockReturnValue(buildPricing()),
    };
    couponsService = {
      reserveRedemption: jest.fn(),
      releaseRedemption: jest.fn().mockResolvedValue(undefined),
      finalizeRedemption: jest.fn().mockResolvedValue(undefined),
    };

    service = new OrdersService(
      prisma as any,
      ordersRepository as any,
      eventBus as any,
      {} as any, // deliveryService
      {} as any, // paymentsService
      {} as any, // restaurantsService
      addressesService as any,
      {} as any, // realtimeService
      queueService as any,
      redisService as any,
      {} as any, // auditService
      logger as any,
      pricingEngineService as any,
      couponsService as any,
    );
  });

  it('creates exactly one order on a first-time request', async () => {
    const order = await service.placeOrder('customer-1', buildDto());

    expect(order.id).toBe('order-1');
    expect(ordersRepository.findOrderByIdempotencyKey).toHaveBeenCalledWith(
      'customer-1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(ordersRepository.createOrder).toHaveBeenCalledTimes(1);
    expect(ordersRepository.createOrder.mock.calls[0][0]).toMatchObject({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      'order.placed',
      expect.anything(),
    );
  });

  it('generates a collision-resistant orderNumber (date + random, not a raw timestamp) — Sprint 1.2A', async () => {
    await service.placeOrder('customer-1', buildDto());

    const created = ordersRepository.createOrder.mock.calls[0][0];
    // ORD-YYYYMMDD-XXXXXX: 8-digit UTC date + 6 hex chars of randomness, not `ORD-<Date.now()>`.
    expect(created.orderNumber).toMatch(/^ORD-\d{8}-[0-9A-F]{6}$/);
  });

  it('generates a different orderNumber for two orders placed back to back', async () => {
    ordersRepository.createOrder
      .mockResolvedValueOnce(buildOrder({ id: 'order-a' }))
      .mockResolvedValueOnce(buildOrder({ id: 'order-b' }));

    await service.placeOrder(
      'customer-1',
      buildDto({ idempotencyKey: 'key-a' }),
    );
    await service.placeOrder(
      'customer-1',
      buildDto({ idempotencyKey: 'key-b' }),
    );

    const first = ordersRepository.createOrder.mock.calls[0][0].orderNumber;
    const second = ordersRepository.createOrder.mock.calls[1][0].orderNumber;
    expect(second).not.toBe(first);
  });

  it('replays the same order for a repeated idempotency key (fast path) without re-running any pipeline work', async () => {
    const existing = buildOrder({ id: 'order-existing' });
    ordersRepository.findOrderByIdempotencyKey.mockResolvedValue(existing);

    const order = await service.placeOrder('customer-1', buildDto());

    expect(order.id).toBe('order-existing');
    // No new order, no pricing/menu lookups, no coupon redemption, no event, no lock — the fast
    // path returns before any of that machinery runs.
    expect(ordersRepository.createOrder).not.toHaveBeenCalled();
    expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
    expect(couponsService.reserveRedemption).not.toHaveBeenCalled();
    expect(couponsService.finalizeRedemption).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(redisService.tryLock).not.toHaveBeenCalled();
  });

  it('creates two separate orders for two different idempotency keys', async () => {
    ordersRepository.createOrder
      .mockResolvedValueOnce(
        buildOrder({ id: 'order-a', idempotencyKey: 'key-a' }),
      )
      .mockResolvedValueOnce(
        buildOrder({ id: 'order-b', idempotencyKey: 'key-b' }),
      );

    const orderA = await service.placeOrder(
      'customer-1',
      buildDto({ idempotencyKey: 'key-a' }),
    );
    const orderB = await service.placeOrder(
      'customer-1',
      buildDto({ idempotencyKey: 'key-b' }),
    );

    expect(orderA.id).toBe('order-a');
    expect(orderB.id).toBe('order-b');
    expect(ordersRepository.createOrder).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('double-click / concurrent duplicate: loses the DB race and returns the winner instead of creating a second order', async () => {
    // Simulates two near-simultaneous requests for the same key both passing the fast-path check
    // (neither sees an order yet) before either has committed.
    const winner = buildOrder({ id: 'order-winner' });
    ordersRepository.createOrder.mockRejectedValueOnce(
      buildUniqueConstraintError(),
    );
    ordersRepository.findOrderByIdempotencyKey
      .mockResolvedValueOnce(null) // initial fast-path check: nothing yet
      .mockResolvedValueOnce(winner); // re-fetch after losing the createOrder race

    const order = await service.placeOrder('customer-1', buildDto());

    expect(order.id).toBe('order-winner');
    // The loser must NOT run any post-creation side effect for its own (failed) attempt.
    expect(couponsService.finalizeRedemption).not.toHaveBeenCalled();
    expect(ordersRepository.createStatusHistory).not.toHaveBeenCalled();
    expect(queueService.addOrderAcceptanceTimeoutJob).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
    // The lock is still released even though this request "lost".
    expect(redisService.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases a reserved coupon slot when the losing side of an idempotency race had one', async () => {
    couponsService.reserveRedemption.mockResolvedValue({
      coupon: { id: 'coupon-1' },
      redemptionId: 'redemption-1',
    });
    const winner = buildOrder({ id: 'order-winner' });
    ordersRepository.createOrder.mockRejectedValueOnce(
      buildUniqueConstraintError(),
    );
    ordersRepository.findOrderByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);

    const order = await service.placeOrder(
      'customer-1',
      buildDto({ couponCode: 'SAVE50' }),
    );

    expect(order.id).toBe('order-winner');
    // This attempt's own reservation was wasted (the winner did its own) — must be released,
    // not left permanently consuming a usage slot.
    expect(couponsService.releaseRedemption).toHaveBeenCalledWith(
      'coupon-1',
      'redemption-1',
    );
    expect(couponsService.finalizeRedemption).not.toHaveBeenCalled();
  });

  it('releases a reserved coupon slot when order creation fails for an unrelated reason', async () => {
    couponsService.reserveRedemption.mockResolvedValue({
      coupon: { id: 'coupon-1' },
      redemptionId: 'redemption-1',
    });
    ordersRepository.createOrder.mockRejectedValue(new Error('db is on fire'));

    await expect(
      service.placeOrder('customer-1', buildDto({ couponCode: 'SAVE50' })),
    ).rejects.toThrow('db is on fire');

    expect(couponsService.releaseRedemption).toHaveBeenCalledWith(
      'coupon-1',
      'redemption-1',
    );
    expect(couponsService.finalizeRedemption).not.toHaveBeenCalled();
  });

  it('rejects fast with ConflictException when another request already holds the lock for this key, without doing any pricing/menu work', async () => {
    redisService.tryLock.mockResolvedValue(false);

    await expect(
      service.placeOrder('customer-1', buildDto()),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.menuItem.findMany).not.toHaveBeenCalled();
    expect(ordersRepository.createOrder).not.toHaveBeenCalled();
    // Never acquired, so nothing to release.
    expect(redisService.releaseLock).not.toHaveBeenCalled();
  });

  it('proceeds and still creates exactly one order when Redis is unavailable (fail-open)', async () => {
    redisService.tryLock.mockRejectedValue(new Error('ECONNREFUSED'));

    const order = await service.placeOrder('customer-1', buildDto());

    expect(order.id).toBe('order-1');
    expect(ordersRepository.createOrder).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'order_placement_lock_unavailable' }),
      'OrdersService',
    );
    // Lock was never actually acquired, so there is nothing to release.
    expect(redisService.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the Redis lock after a successful placement', async () => {
    await service.placeOrder('customer-1', buildDto());

    expect(redisService.tryLock).toHaveBeenCalledTimes(1);
    expect(redisService.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the Redis lock even when order creation fails for an unrelated reason', async () => {
    ordersRepository.createOrder.mockRejectedValue(new Error('db is on fire'));

    await expect(service.placeOrder('customer-1', buildDto())).rejects.toThrow(
      'db is on fire',
    );

    expect(redisService.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('a lock-release failure never masks the real placement result', async () => {
    redisService.releaseLock.mockRejectedValue(
      new Error('redis timeout on DEL'),
    );

    const order = await service.placeOrder('customer-1', buildDto());

    expect(order.id).toBe('order-1');
  });

  it('reserves the coupon slot before creating the order, and finalizes the ledger row exactly once tied to the single created order', async () => {
    couponsService.reserveRedemption.mockResolvedValue({
      coupon: { id: 'coupon-1' },
      redemptionId: 'redemption-1',
    });
    pricingEngineService.calculate.mockReturnValue(
      buildPricing({ discountAmount: 50 }),
    );

    await service.placeOrder('customer-1', buildDto({ couponCode: 'SAVE50' }));

    expect(couponsService.reserveRedemption).toHaveBeenCalledWith(
      'customer-1',
      'SAVE50',
      'restaurant-1',
      398,
    );
    // Reservation happens before order creation — pricing/couponId on the created order must
    // reflect the already-confirmed discount, not a stale pre-reservation guess.
    expect(ordersRepository.createOrder.mock.calls[0][0]).toMatchObject({
      couponId: 'coupon-1',
      discountAmount: 50,
    });
    expect(couponsService.finalizeRedemption).toHaveBeenCalledTimes(1);
    expect(couponsService.finalizeRedemption).toHaveBeenCalledWith(
      'redemption-1',
      'order-1',
      50,
    );
    expect(couponsService.releaseRedemption).not.toHaveBeenCalled();
  });

  it('does not reserve or redeem the coupon again when the same key is replayed after success', async () => {
    couponsService.reserveRedemption.mockResolvedValue({
      coupon: { id: 'coupon-1' },
      redemptionId: 'redemption-1',
    });
    ordersRepository.findOrderByIdempotencyKey.mockResolvedValue(buildOrder());

    await service.placeOrder('customer-1', buildDto({ couponCode: 'SAVE50' }));

    expect(couponsService.reserveRedemption).not.toHaveBeenCalled();
    expect(couponsService.finalizeRedemption).not.toHaveBeenCalled();
  });

  it('rejects order placement (before creating any order) when the coupon reservation itself fails', async () => {
    couponsService.reserveRedemption.mockRejectedValue(
      new Error('This coupon has reached its usage limit'),
    );

    await expect(
      service.placeOrder('customer-1', buildDto({ couponCode: 'SAVE50' })),
    ).rejects.toThrow('This coupon has reached its usage limit');

    expect(ordersRepository.createOrder).not.toHaveBeenCalled();
    expect(couponsService.releaseRedemption).not.toHaveBeenCalled();
  });

  /**
   * Regression coverage for the "tracker shows 'Your order' immediately after checkout" defect:
   * OrdersRepository.createOrder/findOrderByIdempotencyKey now include `restaurant: { select: {
   * name: true } }` (see their own doc comments), so every placeOrder() response path must expose
   * `restaurantName` — the same field GET /orders/me already populates — without ever leaking the
   * raw joined `restaurant` object itself.
   */
  describe('restaurant name in the response', () => {
    it('exposes restaurantName (and only the name, not the raw restaurant object) for a freshly created order', async () => {
      ordersRepository.createOrder.mockResolvedValue(
        buildOrder({ restaurant: { name: 'Paradise Biryani' } }),
      );

      const order = await service.placeOrder('customer-1', buildDto());

      expect(order.restaurantName).toBe('Paradise Biryani');
      expect((order as any).restaurant).toBeUndefined();
    });

    it('exposes restaurantName on the fast-path idempotent replay', async () => {
      ordersRepository.findOrderByIdempotencyKey.mockResolvedValue(
        buildOrder({ id: 'order-existing', restaurant: { name: 'Paradise Biryani' } }),
      );

      const order = await service.placeOrder('customer-1', buildDto());

      expect(order.restaurantName).toBe('Paradise Biryani');
      expect((order as any).restaurant).toBeUndefined();
    });

    it('exposes restaurantName for the winner of a lost idempotency race', async () => {
      const winner = buildOrder({
        id: 'order-winner',
        restaurant: { name: 'Paradise Biryani' },
      });
      ordersRepository.createOrder.mockRejectedValueOnce(buildUniqueConstraintError());
      ordersRepository.findOrderByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);

      const order = await service.placeOrder('customer-1', buildDto());

      expect(order.restaurantName).toBe('Paradise Biryani');
      expect((order as any).restaurant).toBeUndefined();
    });

    it('leaves restaurantName undefined rather than fabricating one when the order has no restaurant relation loaded', async () => {
      ordersRepository.createOrder.mockResolvedValue(buildOrder());

      const order = await service.placeOrder('customer-1', buildDto());

      expect(order.restaurantName).toBeUndefined();
    });
  });
});

/**
 * Payment/order lifecycle Rule 5 ("restaurant acceptance guard") — regression coverage for
 * OrdersService.updateOrderStatus's assertPaymentEligibleForAcceptance: an ONLINE order must not
 * reach CONFIRMED (the restaurant-acceptance transition) unless paymentStatus is PAID; COD never
 * requires pre-payment. Tests use an ADMIN actor so assertOrderAccess/assertActorAllowedForStatus
 * (identity/role checks, already covered elsewhere) pass trivially, isolating the payment check
 * as the one thing under test — matching assertProofVerifiedForStatus's own admin-bypass design.
 */
describe('OrdersService.updateOrderStatus — payment eligibility for restaurant acceptance', () => {
  let service: OrdersService;
  let ordersRepository: {
    findOrderById: jest.Mock;
    updateOrderStatus: jest.Mock;
    createStatusHistory: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let realtimeService: { emitToOrder: jest.Mock };
  const adminUser = { userId: 'admin-1', role: 'ADMIN' } as any;

  function buildPendingOrder(overrides: Partial<any> = {}) {
    return {
      id: 'order-1',
      customerId: 'customer-1',
      restaurantId: 'restaurant-1',
      deliveryPartnerId: null,
      status: 'PENDING',
      paymentMode: 'ONLINE',
      paymentStatus: 'PENDING',
      totalAmount: 220,
      ...overrides,
    };
  }

  beforeEach(() => {
    ordersRepository = {
      findOrderById: jest.fn(),
      updateOrderStatus: jest.fn().mockImplementation((_id, status) =>
        Promise.resolve({ ...buildPendingOrder(), status }),
      ),
      createStatusHistory: jest.fn().mockResolvedValue(undefined),
    };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    realtimeService = { emitToOrder: jest.fn() };

    service = new OrdersService(
      {} as any, // prisma
      ordersRepository as any,
      eventBus as any,
      {} as any, // deliveryService
      {} as any, // paymentsService
      {} as any, // restaurantsService
      {} as any, // addressesService
      realtimeService as any,
      {} as any, // queueService
      {} as any, // redisService
      {} as any, // auditService
      {} as any, // logger
      {} as any, // pricingEngineService
      {} as any, // couponsService
    );
  });

  it('ONLINE + PENDING payment → acceptance is blocked', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOrder({ paymentMode: 'ONLINE', paymentStatus: 'PENDING' }),
    );

    await expect(
      service.updateOrderStatus('order-1', { status: 'CONFIRMED' } as any, adminUser),
    ).rejects.toThrow(ConflictException);

    expect(ordersRepository.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('ONLINE + FAILED payment → acceptance is blocked', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOrder({ paymentMode: 'ONLINE', paymentStatus: 'FAILED' }),
    );

    await expect(
      service.updateOrderStatus('order-1', { status: 'CONFIRMED' } as any, adminUser),
    ).rejects.toThrow(ConflictException);

    expect(ordersRepository.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('ONLINE + PAID → acceptance is allowed', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOrder({ paymentMode: 'ONLINE', paymentStatus: 'PAID' }),
    );

    const result = await service.updateOrderStatus(
      'order-1',
      { status: 'CONFIRMED' } as any,
      adminUser,
    );

    expect(result.status).toBe('CONFIRMED');
    expect(ordersRepository.updateOrderStatus).toHaveBeenCalledWith('order-1', 'CONFIRMED');
  });

  it('COD + PENDING payment → acceptance is allowed (COD never requires pre-payment)', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOrder({ paymentMode: 'COD', paymentStatus: 'PENDING' }),
    );

    const result = await service.updateOrderStatus(
      'order-1',
      { status: 'CONFIRMED' } as any,
      adminUser,
    );

    expect(result.status).toBe('CONFIRMED');
    expect(ordersRepository.updateOrderStatus).toHaveBeenCalledWith('order-1', 'CONFIRMED');
  });

  it('does not re-check payment eligibility for transitions other than CONFIRMED (e.g. PREPARING)', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOrder({ status: 'CONFIRMED', paymentMode: 'ONLINE', paymentStatus: 'PENDING' }),
    );

    const result = await service.updateOrderStatus(
      'order-1',
      { status: 'PREPARING' } as any,
      adminUser,
    );

    expect(result.status).toBe('PREPARING');
  });
});

/**
 * Payment/order lifecycle Rule 4 ("Continue with COD") — regression coverage for
 * OrdersService.switchToCod.
 */
describe('OrdersService.switchToCod', () => {
  let service: OrdersService;
  let ordersRepository: {
    findOrderById: jest.Mock;
    switchPaymentModeIfEligible: jest.Mock;
  };
  const owningCustomer = { userId: 'customer-1', role: 'CUSTOMER' } as any;
  const otherCustomer = { userId: 'customer-2', role: 'CUSTOMER' } as any;
  const admin = { userId: 'admin-1', role: 'ADMIN' } as any;

  function buildPendingOnlineOrder(overrides: Partial<any> = {}) {
    return {
      id: 'order-1',
      customerId: 'customer-1',
      restaurantId: 'restaurant-1',
      status: 'PENDING',
      paymentMode: 'ONLINE',
      paymentStatus: 'PENDING',
      ...overrides,
    };
  }

  beforeEach(() => {
    ordersRepository = {
      findOrderById: jest.fn(),
      switchPaymentModeIfEligible: jest.fn(),
    };

    service = new OrdersService(
      {} as any,
      ordersRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it("switches the customer's own unpaid, still-PENDING ONLINE order to COD", async () => {
    ordersRepository.findOrderById.mockResolvedValue(buildPendingOnlineOrder());
    ordersRepository.switchPaymentModeIfEligible.mockResolvedValue(
      buildPendingOnlineOrder({ paymentMode: 'COD' }),
    );

    const result = await service.switchToCod('order-1', owningCustomer);

    expect(result.paymentMode).toBe('COD');
    expect(ordersRepository.switchPaymentModeIfEligible).toHaveBeenCalledWith('order-1', 'COD');
  });

  it('reuses the same order — never creates a second one', async () => {
    ordersRepository.findOrderById.mockResolvedValue(buildPendingOnlineOrder());
    ordersRepository.switchPaymentModeIfEligible.mockResolvedValue(
      buildPendingOnlineOrder({ paymentMode: 'COD' }),
    );

    const result = await service.switchToCod('order-1', owningCustomer);

    expect(result.id).toBe('order-1');
  });

  it("rejects switching another customer's order", async () => {
    ordersRepository.findOrderById.mockResolvedValue(buildPendingOnlineOrder());

    await expect(service.switchToCod('order-1', otherCustomer)).rejects.toThrow();
    expect(ordersRepository.switchPaymentModeIfEligible).not.toHaveBeenCalled();
  });

  it('allows an admin to switch a customer\'s order on their behalf', async () => {
    ordersRepository.findOrderById.mockResolvedValue(buildPendingOnlineOrder());
    ordersRepository.switchPaymentModeIfEligible.mockResolvedValue(
      buildPendingOnlineOrder({ paymentMode: 'COD' }),
    );

    await expect(service.switchToCod('order-1', admin)).resolves.toBeDefined();
  });

  it('rejects switching an order that has already been paid online', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOnlineOrder({ paymentStatus: 'PAID' }),
    );

    await expect(service.switchToCod('order-1', owningCustomer)).rejects.toThrow(
      ConflictException,
    );
    expect(ordersRepository.switchPaymentModeIfEligible).not.toHaveBeenCalled();
  });

  it('rejects switching an order that is no longer PENDING (already accepted)', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOnlineOrder({ status: 'CONFIRMED' }),
    );

    await expect(service.switchToCod('order-1', owningCustomer)).rejects.toThrow(
      ConflictException,
    );
    expect(ordersRepository.switchPaymentModeIfEligible).not.toHaveBeenCalled();
  });

  it('is a no-op (idempotent) when the order is already COD', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildPendingOnlineOrder({ paymentMode: 'COD' }),
    );

    const result = await service.switchToCod('order-1', owningCustomer);

    expect(result.paymentMode).toBe('COD');
    expect(ordersRepository.switchPaymentModeIfEligible).not.toHaveBeenCalled();
  });

  it('race safety: payment succeeds concurrently — the atomic write loses the race and the call is rejected rather than silently overwriting a now-paid order', async () => {
    ordersRepository.findOrderById.mockResolvedValue(buildPendingOnlineOrder());
    // Simulates OrdersRepository.switchPaymentModeIfEligible's compare-and-swap finding the order
    // no longer eligible (e.g. markOrderPaid won the race) by the time the write actually runs.
    ordersRepository.switchPaymentModeIfEligible.mockResolvedValue(null);

    await expect(service.switchToCod('order-1', owningCustomer)).rejects.toThrow(
      ConflictException,
    );
  });
});
