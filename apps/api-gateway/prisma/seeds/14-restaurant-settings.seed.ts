import { PrismaClient, ServiceChargeType } from '@prisma/client';

import { FLAGSHIP_RESTAURANT_SLUGS } from './erph2a-flagship-restaurants';

/** One restaurant (paradise-biryani) demos autoAcceptOrders=true so the acceptance-timeout
 *  auto-accept path has real seed data to exercise, not just auto-reject. */
const AUTO_ACCEPT_SLUGS = new Set(['paradise-biryani']);

export async function seedRestaurantSettings(prisma: PrismaClient): Promise<void> {
  console.log('⚙️  Seeding restaurant settings...');

  let settingsCount = 0;

  for (const slug of FLAGSHIP_RESTAURANT_SLUGS) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      continue;
    }

    await prisma.restaurantSettings.upsert({
      where: { restaurantId: restaurant.id },
      update: {},
      create: {
        restaurantId: restaurant.id,
        serviceChargeType: ServiceChargeType.PERCENTAGE,
        serviceChargeValue: 5,
        packingChargeType: ServiceChargeType.FLAT,
        packingChargeValue: 15,
        minimumOrderAmount: 99,
        currency: 'INR',
        autoAcceptOrders: AUTO_ACCEPT_SLUGS.has(slug),
        acceptanceTimeoutMinutes: 10,
        orderPreparationDefaultMinutes: 20,
        restaurantNotes: 'Peak hours are 12:30-14:00 and 19:30-22:00 — expect slower acceptance.',
      },
    });

    settingsCount++;
  }

  console.log(`✅ ${settingsCount} restaurant settings rows seeded.`);
}
