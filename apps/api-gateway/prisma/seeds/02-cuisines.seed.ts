import { PrismaClient } from '@prisma/client';

export async function seedCuisines(prisma: PrismaClient): Promise<void> {
  console.log('🍽️ Seeding cuisines...');

  const cuisines = [
    'Indian',
    'Chinese',
    'Italian',
    'Biryani',
    'Fast Food',
    'Bakery',
    'Desserts',
    'South Indian',
    'North Indian',
    'Arabian',
  ];

  for (const name of cuisines) {
    await prisma.cuisine.upsert({
      where: { name },

      update: {},

      create: {
        name,
      },
    });
  }

  console.log(`✅ ${cuisines.length} cuisines seeded.`);
}
