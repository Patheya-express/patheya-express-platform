import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface RestaurantNotificationPreferences {
  notifyOnNewOrder: boolean;
  notifyOnOrderCancelled: boolean;
  notifyOnRefund: boolean;
  notifyOnCustomerMessage: boolean;
}

const DEFAULT_PREFERENCES: RestaurantNotificationPreferences = {
  notifyOnNewOrder: true,
  notifyOnOrderCancelled: true,
  notifyOnRefund: true,
  notifyOnCustomerMessage: true,
};

/**
 * Restaurants without a RestaurantSettings row yet (the row is created lazily on first
 * read/write — see SettingsService) get the same defaults the schema declares, so notification
 * behavior is correct before a restaurant ever touches its settings.
 */
export async function getRestaurantNotificationPreferences(
  prisma: PrismaService,
  restaurantId: string,
): Promise<RestaurantNotificationPreferences> {
  const settings = await prisma.restaurantSettings.findUnique({
    where: { restaurantId },
    select: {
      notifyOnNewOrder: true,
      notifyOnOrderCancelled: true,
      notifyOnRefund: true,
      notifyOnCustomerMessage: true,
    },
  });

  return settings ?? DEFAULT_PREFERENCES;
}

/**
 * Every user who should receive restaurant-facing order notifications: the owner plus every
 * ACTIVE staff member, deduplicated (the owner may also appear as an ACTIVE staff row).
 */
export async function getActiveRestaurantRecipientIds(
  prisma: PrismaService,
  restaurantId: string,
): Promise<string[]> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      ownerId: true,
      staff: {
        where: { status: 'ACTIVE' },
        select: { userId: true },
      },
    },
  });

  if (!restaurant) {
    return [];
  }

  return Array.from(
    new Set([
      restaurant.ownerId,
      ...restaurant.staff.map((staff) => staff.userId),
    ]),
  );
}
