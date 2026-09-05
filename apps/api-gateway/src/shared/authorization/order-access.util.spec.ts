import { UserRole } from '@prisma/client';

import { canAccessOrder, OrderAccessRecord } from './order-access.util';

// This is the single function `RealtimeGateway.isAuthorizedForRoom` calls to decide whether a
// socket may `join-room` an `order:<id>` room — the room `tracking.location` events are broadcast
// to. AUDIT-016 requires a customer must not be able to subscribe to another customer's/order's
// location stream; this is the enforcement point for that.
describe('canAccessOrder', () => {
  const order: OrderAccessRecord = {
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    deliveryPartnerId: 'partner-1',
  };
  const prisma = {} as any; // never reached for these roles — no restaurant lookup needed

  it("allows the order's own customer", async () => {
    await expect(
      canAccessOrder(prisma, order, { userId: 'customer-1', role: UserRole.CUSTOMER }),
    ).resolves.toBe(true);
  });

  it('denies a different customer', async () => {
    await expect(
      canAccessOrder(prisma, order, { userId: 'customer-2', role: UserRole.CUSTOMER }),
    ).resolves.toBe(false);
  });

  it("allows the order's assigned delivery partner", async () => {
    await expect(
      canAccessOrder(prisma, order, { userId: 'partner-1', role: UserRole.DELIVERY_PARTNER }),
    ).resolves.toBe(true);
  });

  it('denies a delivery partner not assigned to this order', async () => {
    await expect(
      canAccessOrder(prisma, order, { userId: 'partner-2', role: UserRole.DELIVERY_PARTNER }),
    ).resolves.toBe(false);
  });

  it('always allows admins and super admins', async () => {
    await expect(
      canAccessOrder(prisma, order, { userId: 'anyone', role: UserRole.ADMIN }),
    ).resolves.toBe(true);
    await expect(
      canAccessOrder(prisma, order, { userId: 'anyone', role: UserRole.SUPER_ADMIN }),
    ).resolves.toBe(true);
  });
});
