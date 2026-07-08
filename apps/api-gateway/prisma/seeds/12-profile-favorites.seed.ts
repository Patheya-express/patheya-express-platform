import { PrismaClient, ThemePreference } from '@prisma/client';

/**
 * Realistic profile + favorites demo data for the seeded customer: an avatar, non-default
 * preferences (to prove PATCH actually persists rather than just returning defaults), and a
 * handful of favorite restaurants/dishes so the Favorites page and heart-toggle states have
 * something to show immediately after a fresh seed.
 */
export async function seedProfileAndFavorites(prisma: PrismaClient): Promise<void> {
  console.log('👤 Seeding customer profile and favorites...');

  const customer = await prisma.user.findUnique({
    where: { email: 'customer@patheyaexpress.com' },
  });

  if (!customer) {
    console.log('⚠️  Skipping profile/favorites seed — customer user not found.');
    return;
  }

  // No avatarUrl is seeded here — unlike restaurants (which also leave logoUrl/bannerUrl empty
  // in seed data), there is no real file on disk to point at, and a fabricated path would 404.
  // The frontend already falls back to initials when avatarUrl is unset; a real avatar only
  // ever gets set via the actual upload endpoint once a file genuinely exists.
  await prisma.user.update({
    where: { id: customer.id },
    data: {
      avatarUrl: null,
      preferredLanguage: 'en',
      themePreference: ThemePreference.DARK,
      marketingOptIn: true,
      timezone: 'Asia/Kolkata',
    },
  });

  await prisma.notificationPreference.upsert({
    where: { userId: customer.id },
    update: {
      promotionsEmail: true,
      promotionsPush: true,
    },
    create: {
      userId: customer.id,
      promotionsEmail: true,
      promotionsPush: true,
    },
  });

  const favoriteSlugs = ['paradise-biryani', 'shah-ghouse', 'pista-house'];

  const favoriteRestaurants = await prisma.restaurant.findMany({
    where: { slug: { in: favoriteSlugs } },
  });

  for (const restaurant of favoriteRestaurants) {
    await prisma.restaurantFavorite.upsert({
      where: {
        customerId_restaurantId: {
          customerId: customer.id,
          restaurantId: restaurant.id,
        },
      },
      update: {},
      create: { customerId: customer.id, restaurantId: restaurant.id },
    });
  }

  const paradiseBiryani = favoriteRestaurants.find(
    (r) => r.slug === 'paradise-biryani',
  );

  if (paradiseBiryani) {
    const menuItems = await prisma.menuItem.findMany({
      where: { category: { restaurantId: paradiseBiryani.id } },
      take: 2,
    });

    for (const item of menuItems) {
      await prisma.menuItemFavorite.upsert({
        where: {
          customerId_menuItemId: {
            customerId: customer.id,
            menuItemId: item.id,
          },
        },
        update: {},
        create: { customerId: customer.id, menuItemId: item.id },
      });
    }
  }
}
