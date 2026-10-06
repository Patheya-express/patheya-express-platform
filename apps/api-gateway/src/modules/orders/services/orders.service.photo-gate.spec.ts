import { ForbiddenException } from '@nestjs/common';
import { DeliveryProofOtpStatus, OrderStatus, UserRole } from '@prisma/client';

import { OrdersService } from './orders.service';

/**
 * Business requirement (delivery parcel photo + customer confirmation + OTP-gated delivery) —
 * regression coverage for assertPhotoVerifiedForStatus, the pickup-photo mirror of the pre-existing
 * assertProofVerifiedForStatus gate. Both are checked from the same updateOrderStatus choke point
 * every status-change caller (generic PATCH, shortcut routes, ProofService.verify) already goes
 * through, so this exercises updateOrderStatus directly rather than the private method in
 * isolation — that's what actually proves the bypass is closed.
 */

const RIDER = { userId: 'rider-1', role: UserRole.DELIVERY_PARTNER };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    deliveryPartnerId: 'rider-1',
    status: OrderStatus.READY_FOR_PICKUP,
    paymentMode: 'ONLINE',
    paymentStatus: 'PAID',
    totalAmount: 100,
    ...overrides,
  };
}

describe('OrdersService.updateOrderStatus — pickup-photo gate (OUT_FOR_DELIVERY)', () => {
  let service: OrdersService;
  let prisma: {
    deliveryProofOtp: { findUnique: jest.Mock };
    deliveryProofPhoto: { findUnique: jest.Mock };
    restaurant?: { findUnique: jest.Mock };
  };
  let ordersRepository: {
    findOrderById: jest.Mock;
    updateOrderStatus: jest.Mock;
    createStatusHistory: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let realtimeService: { emitToOrder: jest.Mock };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  const VERIFIED_PICKUP_OTP = {
    status: DeliveryProofOtpStatus.VERIFIED,
  };

  beforeEach(() => {
    prisma = {
      deliveryProofOtp: {
        findUnique: jest.fn().mockResolvedValue(VERIFIED_PICKUP_OTP),
      },
      deliveryProofPhoto: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    ordersRepository = {
      findOrderById: jest.fn().mockResolvedValue(buildOrder()),
      updateOrderStatus: jest
        .fn()
        .mockResolvedValue(
          buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY }),
        ),
      createStatusHistory: jest.fn().mockResolvedValue(undefined),
    };

    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    realtimeService = { emitToOrder: jest.fn() };
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    service = new OrdersService(
      prisma as any,
      ordersRepository as any,
      eventBus as any,
      {} as any, // deliveryService
      {} as any, // paymentsService
      {} as any, // restaurantsService
      {} as any, // addressesService
      realtimeService as any,
      {} as any, // queueService
      {} as any, // redisService
      { log: jest.fn().mockResolvedValue(undefined) } as any, // auditService
      logger as any,
      {} as any, // pricingEngineService
      {} as any, // couponsService
    );
  });

  it('rejects a delivery partner advancing to OUT_FOR_DELIVERY without a pickup photo, even with a verified pickup OTP', async () => {
    prisma.deliveryProofPhoto.findUnique.mockResolvedValue(null);

    await expect(
      service.updateOrderStatus(
        'order-1',
        { status: OrderStatus.OUT_FOR_DELIVERY },
        RIDER,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(ordersRepository.updateOrderStatus).not.toHaveBeenCalled();
  });

  it('allows a delivery partner to advance to OUT_FOR_DELIVERY once a pickup photo exists (and the OTP is verified)', async () => {
    prisma.deliveryProofPhoto.findUnique.mockResolvedValue({ id: 'photo-1' });

    const result = await service.updateOrderStatus(
      'order-1',
      { status: OrderStatus.OUT_FOR_DELIVERY },
      RIDER,
    );

    expect(result.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
    expect(ordersRepository.updateOrderStatus).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.OUT_FOR_DELIVERY,
    );
  });

  it('still rejects without a photo even if a malicious client also fabricates a verified OTP response', async () => {
    prisma.deliveryProofOtp.findUnique.mockResolvedValue(VERIFIED_PICKUP_OTP);
    prisma.deliveryProofPhoto.findUnique.mockResolvedValue(null);

    await expect(
      service.updateOrderStatus(
        'order-1',
        { status: OrderStatus.OUT_FOR_DELIVERY },
        RIDER,
      ),
    ).rejects.toThrow(/pickup photo is required/);
  });

  it('lets an admin bypass the photo gate (support override), matching the existing OTP-gate bypass', async () => {
    prisma.deliveryProofPhoto.findUnique.mockResolvedValue(null);

    const result = await service.updateOrderStatus(
      'order-1',
      { status: OrderStatus.OUT_FOR_DELIVERY },
      ADMIN,
    );

    expect(result.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
  });

  it('does not consult the photo gate for statuses that do not require one (e.g. CONFIRMED)', async () => {
    ordersRepository.findOrderById.mockResolvedValue(
      buildOrder({ status: OrderStatus.PENDING, deliveryPartnerId: null }),
    );
    ordersRepository.updateOrderStatus.mockResolvedValue(
      buildOrder({ status: OrderStatus.CONFIRMED }),
    );
    prisma.restaurant = {
      findUnique: jest.fn().mockResolvedValue({
        ownerId: 'restaurant-1',
        staff: [],
      }),
    };

    await service.updateOrderStatus(
      'order-1',
      { status: OrderStatus.CONFIRMED },
      { userId: 'restaurant-1', role: UserRole.RESTAURANT_OWNER },
    );

    expect(prisma.deliveryProofPhoto.findUnique).not.toHaveBeenCalled();
  });
});
