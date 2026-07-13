import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface RestaurantOrderSettings {
  autoAcceptOrders: boolean;
  acceptanceTimeoutMinutes: number;
}

/** Mirrors the @default values declared on RestaurantSettings, applied for restaurants that
 *  haven't saved a settings row yet (created lazily — see SettingsService). */
const DEFAULT_ORDER_SETTINGS: RestaurantOrderSettings = {
  autoAcceptOrders: false,
  acceptanceTimeoutMinutes: 10,
};

export async function getRestaurantOrderSettings(
  prisma: PrismaService,
  restaurantId: string,
): Promise<RestaurantOrderSettings> {
  const settings = await prisma.restaurantSettings.findUnique({
    where: { restaurantId },
    select: { autoAcceptOrders: true, acceptanceTimeoutMinutes: true },
  });

  if (!settings) {
    return DEFAULT_ORDER_SETTINGS;
  }

  return {
    autoAcceptOrders: settings.autoAcceptOrders,
    acceptanceTimeoutMinutes: settings.acceptanceTimeoutMinutes,
  };
}
