import {
  RestaurantStaffRole,
  RestaurantStaffStatus,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
}

/** The effective role a user has over a specific restaurant, for RBAC checks finer than
 *  "can they access it at all." 'ADMIN' covers both ADMIN and SUPER_ADMIN platform roles. */
export type RestaurantAccessRole = RestaurantStaffRole | 'ADMIN';

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
  return (await getRestaurantRole(prisma, restaurantId, user)) !== null;
}

/**
 * Resolves the effective role a user has over a restaurant, checking (in order) the platform
 * admin role, the legacy single-owner `Restaurant.ownerId` pointer (kept for backward
 * compatibility), and — the ERPH-1 addition — active `RestaurantStaff` membership. This is the
 * one authorization utility in the codebase already shaped for per-restaurant access, extended
 * here rather than introducing a second authorization mechanism.
 */
export async function getRestaurantRole(
  prisma: PrismaService,
  restaurantId: string,
  user: AuthenticatedUser,
): Promise<RestaurantAccessRole | null> {
  if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
    return 'ADMIN';
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      ownerId: true,
      staff: {
        where: { userId: user.userId, status: RestaurantStaffStatus.ACTIVE },
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!restaurant) {
    return null;
  }

  if (restaurant.ownerId === user.userId) {
    return RestaurantStaffRole.OWNER;
  }

  return restaurant.staff[0]?.role ?? null;
}

/** Convenience check for endpoints restricted to a specific subset of restaurant roles, e.g.
 *  bank/tax edits limited to OWNER/CO_OWNER. ADMIN/SUPER_ADMIN must be included explicitly if
 *  they should be allowed to bypass the restriction. */
export async function hasRestaurantRole(
  prisma: PrismaService,
  restaurantId: string,
  user: AuthenticatedUser,
  allowedRoles: RestaurantAccessRole[],
): Promise<boolean> {
  const role = await getRestaurantRole(prisma, restaurantId, user);

  return role !== null && allowedRoles.includes(role);
}
