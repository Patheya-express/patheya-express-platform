import { PrismaClient } from '@prisma/client';

import { seedUsers } from './seeds/01-users.seed';
import { seedCuisines } from './seeds/02-cuisines.seed';
import { seedRestaurants } from './seeds/03-restaurants.seed';
import { seedDeliveryPartners } from './seeds/08-delivery-partners.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  await seedUsers(prisma);
  await seedCuisines(prisma);
  await seedRestaurants(prisma);
  await seedDeliveryPartners(prisma);

  console.log('✅ Database seed completed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
