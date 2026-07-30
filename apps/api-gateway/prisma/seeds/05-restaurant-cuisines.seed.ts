import { PrismaClient } from '@prisma/client';

import { RESTAURANTS } from './restaurant-data';

/** Keyword-matched cuisine tags per restaurant — falls back to a rotating default set for
 *  restaurants whose name/description doesn't obviously match a cuisine keyword. */
const CUISINE_RULES: Array<{ keyword: string; cuisines: string[] }> = [
  { keyword: 'biryani', cuisines: ['Biryani', 'Indian'] },
  { keyword: 'pizza', cuisines: ['Italian', 'Fast Food'] },
  { keyword: 'burger', cuisines: ['Fast Food'] },
  { keyword: 'kfc', cuisines: ['Fast Food'] },
  { keyword: "mcdonald", cuisines: ['Fast Food'] },
  { keyword: 'subway', cuisines: ['Fast Food'] },
  { keyword: 'bakery', cuisines: ['Bakery', 'Desserts'] },
  { keyword: 'cafe', cuisines: ['Bakery', 'Desserts'] },
  { keyword: 'south indian', cuisines: ['South Indian'] },
  { keyword: 'andhra', cuisines: ['South Indian', 'Indian'] },
  { keyword: 'mughlai', cuisines: ['North Indian', 'Arabian'] },
  { keyword: 'barbecue', cuisines: ['North Indian'] },
  { keyword: 'barbeque', cuisines: ['North Indian'] },
  { keyword: 'multi-cuisine', cuisines: ['Indian', 'Chinese'] },
];

const DEFAULT_ROTATION = [
  ['Indian', 'North Indian'],
  ['Chinese', 'Fast Food'],
  ['Biryani', 'Indian'],
];

function resolveCuisineNames(restaurant: { name: string; description: string }): string[] {
  const haystack = `${restaurant.name} ${restaurant.description}`.toLowerCase();

  for (const rule of CUISINE_RULES) {
    if (haystack.includes(rule.keyword)) {
      return rule.cuisines;
    }
  }

  return DEFAULT_ROTATION[restaurant.name.length % DEFAULT_ROTATION.length];
}

export async function seedRestaurantCuisines(prisma: PrismaClient): Promise<void> {
  console.log('🏷️  Seeding restaurant-cuisine assignments...');

  const cuisines = await prisma.cuisine.findMany();
  const cuisineIdByName = new Map(cuisines.map((cuisine) => [cuisine.name, cuisine.id]));

  let assignmentCount = 0;

  for (const restaurant of RESTAURANTS) {
    const dbRestaurant = await prisma.restaurant.findUnique({
      where: { slug: restaurant.slug },
      select: { id: true },
    });

    if (!dbRestaurant) {
      continue;
    }

    const cuisineNames = resolveCuisineNames(restaurant);

    for (const cuisineName of cuisineNames) {
      const cuisineId = cuisineIdByName.get(cuisineName);

      if (!cuisineId) {
        continue;
      }

      await prisma.restaurantCuisine.upsert({
        where: {
          restaurantId_cuisineId: { restaurantId: dbRestaurant.id, cuisineId },
        },
        update: {},
        create: { restaurantId: dbRestaurant.id, cuisineId },
      });

      assignmentCount++;
    }
  }

  console.log(`✅ ${assignmentCount} restaurant-cuisine assignments seeded.`);
}
