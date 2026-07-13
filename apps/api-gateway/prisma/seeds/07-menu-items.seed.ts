import { PrismaClient } from '@prisma/client';

import { FLAGSHIP_RESTAURANT_SLUGS } from './erph2a-flagship-restaurants';
import { MENU_TEMPLATE } from './menu-template';

export async function seedMenuItems(prisma: PrismaClient): Promise<void> {
  console.log('🍛 Seeding menu items...');

  let itemCount = 0;

  for (const slug of FLAGSHIP_RESTAURANT_SLUGS) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      continue;
    }

    for (const categoryTemplate of MENU_TEMPLATE) {
      const category = await prisma.menuCategory.findFirst({
        where: { restaurantId: restaurant.id, name: categoryTemplate.name },
      });

      if (!category) {
        continue;
      }

      for (const itemTemplate of categoryTemplate.items) {
        const existing = await prisma.menuItem.findFirst({
          where: { categoryId: category.id, name: itemTemplate.name },
        });

        if (existing) {
          continue;
        }

        const menuItem = await prisma.menuItem.create({
          data: {
            categoryId: category.id,
            name: itemTemplate.name,
            description: itemTemplate.description,
            basePrice: itemTemplate.basePrice,
            isVegetarian: itemTemplate.isVegetarian ?? false,
            isVegan: itemTemplate.isVegan ?? false,
            isAvailable: true,
            preparationTime: 20,
          },
        });

        itemCount++;

        for (const variant of itemTemplate.variants ?? []) {
          await prisma.menuItemVariant.create({
            data: {
              menuItemId: menuItem.id,
              name: variant.name,
              price: variant.price,
              isDefault: variant.name === 'Half',
            },
          });
        }

        for (const addon of itemTemplate.addons ?? []) {
          const createdAddon = await prisma.menuItemAddon.create({
            data: {
              menuItemId: menuItem.id,
              name: addon.name,
              minSelection: addon.minSelection,
              maxSelection: addon.maxSelection,
            },
          });

          for (const option of addon.options) {
            await prisma.menuItemAddonOption.create({
              data: {
                addonId: createdAddon.id,
                name: option.name,
                price: option.price,
                isAvailable: true,
              },
            });
          }
        }
      }
    }
  }

  // Recompute the derived veg/vegan restaurant flags now that flagship restaurants actually have
  // menu items — mirrors MenuRepository.recomputeVegFlags, run once here since bulk-seeding
  // bypasses the normal create-menu-item API path that would otherwise trigger it per item.
  for (const slug of FLAGSHIP_RESTAURANT_SLUGS) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!restaurant) {
      continue;
    }

    const [vegCount, veganCount] = await Promise.all([
      prisma.menuItem.count({
        where: { category: { restaurantId: restaurant.id }, isVegetarian: true },
      }),
      prisma.menuItem.count({
        where: { category: { restaurantId: restaurant.id }, isVegan: true },
      }),
    ]);

    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { hasVegOptions: vegCount > 0, hasVeganOptions: veganCount > 0 },
    });
  }

  console.log(`✅ ${itemCount} menu items seeded (with variants/addons) across ${FLAGSHIP_RESTAURANT_SLUGS.length} restaurants.`);
}
