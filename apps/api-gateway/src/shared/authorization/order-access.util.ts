import { UserRole } from '@prisma/client';

import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
}

export interface OrderAccessRecord {
  customerId: string;
  restaurantId: string;
  deliveryPartnerId: string | null;
}

/**
 * Single source of truth for "can this user see/act on this order" — reused by OrdersService
 * (REST endpoints) and RealtimeGateway (Socket.IO room joins) so the rule is defined once.
 * Customers own their own orders, delivery partners own their assigned orders, restaurant
 * owners/managers own their restaurant's orders, and admins have unrestricted access.
 */
export async function canAccessOrder(
  prisma: PrismaService,
  order: OrderAccessRecord,
  user: AuthenticatedUser,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  if (order.customerId === user.userId) {
    return true;
  }

  if (order.deliveryPartnerId === user.userId) {
    return true;
  }

  if (
    user.role === UserRole.RESTAURANT_OWNER ||
    user.role === UserRole.RESTAURANT_MANAGER
  ) {
    return canAccessRestaurant(prisma, order.restaurantId, user);
  }

  return false;
}

/** Single source of truth for "can this user see/act on this restaurant's data." */
export async function canAccessRestaurant(
  prisma: PrismaService,
  restaurantId: string,
  user: AuthenticatedUser,
): Promise<boolean> {
  if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  if (
    user.role !== UserRole.RESTAURANT_OWNER &&
    user.role !== UserRole.RESTAURANT_MANAGER
  ) {
    return false;
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { ownerId: true },
  });

  return restaurant?.ownerId === user.userId;
}
