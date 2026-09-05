import { PrismaClient } from '@prisma/client';

import { seedUsers } from './seeds/01-users.seed';
import { seedCuisines } from './seeds/02-cuisines.seed';
import { seedRestaurants } from './seeds/03-restaurants.seed';
import { seedBranches } from './seeds/04-branches.seed';
import { seedRestaurantCuisines } from './seeds/05-restaurant-cuisines.seed';
import { seedMenuCategories } from './seeds/06-menu-categories.seed';
import { seedMenuItems } from './seeds/07-menu-items.seed';
import { seedDeliveryPartners } from './seeds/08-delivery-partners.seed';
import { seedOrders } from './seeds/09-orders.seed';
import { seedCoupons } from './seeds/10-coupons.seed';
import { seedOffers } from './seeds/11-offers.seed';
import { seedProfileAndFavorites } from './seeds/12-profile-favorites.seed';
import { seedRestaurantStaff } from './seeds/13-restaurant-staff.seed';
import { seedRestaurantSettings } from './seeds/14-restaurant-settings.seed';
import { seedRestaurantDashboardDemoOrders } from './seeds/15-restaurant-dashboard-demo.seed';
import { seedSupportContent } from './seeds/16-support-content.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  await seedUsers(prisma);
  await seedCuisines(prisma);
  await seedRestaurants(prisma);
  await seedBranches(prisma);
  await seedRestaurantCuisines(prisma);
  await seedMenuCategories(prisma);
  await seedMenuItems(prisma);
  await seedDeliveryPartners(prisma);
  await seedOrders(prisma);
  await seedCoupons(prisma);
  await seedRestaurantStaff(prisma);
  await seedRestaurantSettings(prisma);
  await seedRestaurantDashboardDemoOrders(prisma);
  await seedOffers(prisma);
  await seedProfileAndFavorites(prisma);
  await seedSupportContent(prisma);

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
