import { PrismaClient, RestaurantStatus } from '@prisma/client';

import { RESTAURANTS } from './restaurant-data';

export async function seedRestaurants(prisma: PrismaClient): Promise<void> {
  console.log('🏪 Seeding restaurants...');

  const owner = await prisma.user.findUnique({
    where: {
      email: 'owner@patheyaexpress.com',
    },
  });

  if (!owner) {
    throw new Error('Restaurant owner not found. Run 01-users.seed.ts first.');
  }

  for (const restaurant of RESTAURANTS) {
    await prisma.restaurant.upsert({
      where: {
        slug: restaurant.slug,
      },

      update: {},

      create: {
        ownerId: owner.id,

        name: restaurant.name,
        slug: restaurant.slug,
        description: restaurant.description,
        phone: restaurant.phone,
        email: restaurant.email,

        status: RestaurantStatus.APPROVED,

        isActive: true,
      },
    });
  }

  console.log(`✅ ${RESTAURANTS.length} restaurants seeded.`);
}
