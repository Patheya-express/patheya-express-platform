import { PrismaClient } from '@prisma/client';

import { FLAGSHIP_RESTAURANT_SLUGS } from './erph2a-flagship-restaurants';
import { MENU_TEMPLATE } from './menu-template';

export async function seedMenuCategories(prisma: PrismaClient): Promise<void> {
  console.log('📋 Seeding menu categories...');

  let categoryCount = 0;

  for (const slug of FLAGSHIP_RESTAURANT_SLUGS) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      continue;
    }

    for (const [index, category] of MENU_TEMPLATE.entries()) {
      const existing = await prisma.menuCategory.findFirst({
        where: { restaurantId: restaurant.id, name: category.name },
      });

      if (existing) {
        continue;
      }

      await prisma.menuCategory.create({
        data: {
          restaurantId: restaurant.id,
          name: category.name,
          description: category.description,
          sortOrder: index,
          isActive: true,
        },
      });

      categoryCount++;
    }
  }

  console.log(`✅ ${categoryCount} menu categories seeded across ${FLAGSHIP_RESTAURANT_SLUGS.length} restaurants.`);
}
