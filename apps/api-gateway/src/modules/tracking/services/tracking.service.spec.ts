import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { TrackingService } from './tracking.service';

function buildService() {
  const redisService = { set: jest.fn().mockResolvedValue(undefined), get: jest.fn() };
  const realtimeService = { emitToOrder: jest.fn() };
  const ordersService = { getOrderOwnership: jest.fn(), assertOrderAccessById: jest.fn() };
  const prisma = { deliveryPartner: { updateMany: jest.fn().mockResolvedValue(undefined) } };

  const service = new TrackingService(
    redisService as any,
    realtimeService as any,
    ordersService as any,
    prisma as any,
  );

  return { service, redisService, realtimeService, ordersService, prisma };
}

// AUDIT-016 security requirement: a delivery partner must not be able to submit location updates
// for another delivery. `updateLocation` is the only write path onto the live-tracking Redis key
// and the only trigger for the `tracking.location` broadcast, so this is the enforcement point.
describe('TrackingService.updateLocation', () => {
  const ASSIGNED_PARTNER_ID = 'partner-assigned';
  const OTHER_PARTNER_ID = 'partner-other';
  const order = {
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    deliveryPartnerId: ASSIGNED_PARTNER_ID,
    latitude: 12.9,
    longitude: 77.6,
  };

  it("rejects a delivery partner who is not this order's assigned partner", async () => {
    const { service, ordersService, redisService, realtimeService } = buildService();
    ordersService.getOrderOwnership.mockResolvedValue(order);

    await expect(
      service.updateLocation('order-1', 12.91, 77.61, {
        userId: OTHER_PARTNER_ID,
        role: UserRole.DELIVERY_PARTNER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(redisService.set).not.toHaveBeenCalled();
    expect(realtimeService.emitToOrder).not.toHaveBeenCalled();
  });

  it('rejects a customer, restaurant owner, or any non-assigned role outright', async () => {
    const { service, ordersService } = buildService();
    ordersService.getOrderOwnership.mockResolvedValue(order);

    await expect(
      service.updateLocation('order-1', 12.91, 77.61, {
        userId: order.customerId,
        role: UserRole.CUSTOMER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts the order’s assigned delivery partner and broadcasts the update', async () => {
    const { service, ordersService, redisService, realtimeService, prisma } = buildService();
    ordersService.getOrderOwnership.mockResolvedValue(order);

    const result = await service.updateLocation('order-1', 12.91, 77.61, {
      userId: ASSIGNED_PARTNER_ID,
      role: UserRole.DELIVERY_PARTNER,
    });

    expect(result.latitude).toBe(12.91);
    expect(result.longitude).toBe(77.61);
    expect(redisService.set).toHaveBeenCalledWith(
      'tracking:order:order-1',
      expect.any(String),
      15 * 60,
    );
    expect(realtimeService.emitToOrder).toHaveBeenCalledWith(
      'order-1',
      'tracking.location',
      expect.objectContaining({ latitude: 12.91, longitude: 77.61 }),
    );
    expect(prisma.deliveryPartner.updateMany).toHaveBeenCalledWith({
      where: { userId: ASSIGNED_PARTNER_ID },
      data: { currentLatitude: 12.91, currentLongitude: 77.61 },
    });
  });

  it('accepts an admin regardless of assignment', async () => {
    const { service, ordersService, redisService } = buildService();
    ordersService.getOrderOwnership.mockResolvedValue(order);

    await service.updateLocation('order-1', 12.91, 77.61, {
      userId: 'some-admin',
      role: UserRole.ADMIN,
    });

    expect(redisService.set).toHaveBeenCalled();
  });

  it('computes distance/ETA against the order destination when it has coordinates', async () => {
    const { service, ordersService } = buildService();
    ordersService.getOrderOwnership.mockResolvedValue(order);

    const result = await service.updateLocation('order-1', order.latitude, order.longitude, {
      userId: ASSIGNED_PARTNER_ID,
      role: UserRole.DELIVERY_PARTNER,
    });

    expect(result.distanceKm).toBeCloseTo(0, 3);
    expect(result.etaMinutes).toBe(1);
  });
});

describe('TrackingService.getOrderLocation', () => {
  it('delegates authorization to assertOrderAccessById before reading Redis', async () => {
    const { service, ordersService, redisService } = buildService();
    ordersService.assertOrderAccessById.mockRejectedValue(new ForbiddenException());

    await expect(
      service.getOrderLocation('order-1', { userId: 'stranger', role: UserRole.CUSTOMER }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(redisService.get).not.toHaveBeenCalled();
  });

  it('returns null when no location has been reported yet', async () => {
    const { service, ordersService, redisService } = buildService();
    ordersService.assertOrderAccessById.mockResolvedValue({});
    redisService.get.mockResolvedValue(null);

    const result = await service.getOrderLocation('order-1', {
      userId: 'customer-1',
      role: UserRole.CUSTOMER,
    });

    expect(result).toBeNull();
  });

  it('returns the parsed tracking payload once authorized', async () => {
    const { service, ordersService, redisService } = buildService();
    ordersService.assertOrderAccessById.mockResolvedValue({});
    redisService.get.mockResolvedValue(JSON.stringify({ latitude: 1, longitude: 2, updatedAt: '2026-01-01' }));

    const result = await service.getOrderLocation('order-1', {
      userId: 'customer-1',
      role: UserRole.CUSTOMER,
    });

    expect(result).toEqual({ latitude: 1, longitude: 2, updatedAt: '2026-01-01' });
  });
});
