import { PrismaClient } from '@prisma/client';

import { RESTAURANTS } from './restaurant-data';
import { FLAGSHIP_RESTAURANT_SLUGS } from './erph2a-flagship-restaurants';

const BASE_LAT = 12.9352;
const BASE_LNG = 77.6146;

/** Areas used for the flagship restaurants' extra branches — enough to make a branch switcher
 *  meaningful without hand-writing 15 unique addresses. */
const AREAS = [
  { name: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', postalCode: '560095', latOffset: 0, lngOffset: 0 },
  { name: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', postalCode: '560038', latOffset: 0.03, lngOffset: 0.02 },
  { name: 'Whitefield', city: 'Bengaluru', state: 'Karnataka', postalCode: '560066', latOffset: 0.08, lngOffset: 0.09 },
  { name: 'Jayanagar', city: 'Bengaluru', state: 'Karnataka', postalCode: '560041', latOffset: -0.05, lngOffset: -0.02 },
];

/**
 * Weekly schedule variants — index 0 is a plain single-shift branch, index 1 has a lunch+dinner
 * split shift (Monday closed), so the operating-hours CRUD and computeIsOpenNow's split-shift
 * support both have realistic seed data to exercise.
 */
function buildHours(branchIndex: number) {
  if (branchIndex === 1) {
    return Array.from({ length: 7 }, (_, dayOfWeek) => {
      if (dayOfWeek === 1) {
        return [{ dayOfWeek, opensAt: '00:00', closesAt: '00:00', isClosed: true }];
      }

      return [
        { dayOfWeek, opensAt: '11:00', closesAt: '15:00', isClosed: false },
        { dayOfWeek, opensAt: '18:00', closesAt: '23:00', isClosed: false },
      ];
    }).flat();
  }

  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    opensAt: '10:00',
    closesAt: '23:00',
    isClosed: false,
  }));
}

async function createBranch(
  prisma: PrismaClient,
  restaurantId: string,
  branchIndex: number,
  namePrefix: string,
) {
  const area = AREAS[branchIndex % AREAS.length];
  const name = `${namePrefix} - ${area.name}`;

  const existing = await prisma.restaurantBranch.findFirst({
    where: { restaurantId, name },
  });

  if (existing) {
    return existing;
  }

  const branch = await prisma.restaurantBranch.create({
    data: {
      restaurantId,
      name,
      addressLine1: `${100 + branchIndex} ${area.name} Main Road`,
      city: area.city,
      state: area.state,
      postalCode: area.postalCode,
      latitude: BASE_LAT + area.latOffset,
      longitude: BASE_LNG + area.lngOffset,
      timezone: 'Asia/Kolkata',
      deliveryRadiusKm: 5 + branchIndex,
      phone: `98765${String(branchIndex).padStart(5, '0')}`,
      isPrimary: branchIndex === 0,
    },
  });

  await prisma.operatingHour.createMany({
    data: buildHours(branchIndex).map((hour) => ({ ...hour, branchId: branch.id })),
  });

  return branch;
}

export async function seedBranches(prisma: PrismaClient): Promise<void> {
  console.log('🏬 Seeding branches...');

  let branchCount = 0;

  for (const restaurant of RESTAURANTS) {
    const dbRestaurant = await prisma.restaurant.findUnique({
      where: { slug: restaurant.slug },
      select: { id: true },
    });

    if (!dbRestaurant) {
      continue;
    }

    const isFlagship = (FLAGSHIP_RESTAURANT_SLUGS as readonly string[]).includes(
      restaurant.slug,
    );

    const branchTarget = isFlagship ? 3 : 1;

    for (let i = 0; i < branchTarget; i++) {
      await createBranch(prisma, dbRestaurant.id, i, restaurant.name);
      branchCount++;
    }
  }

  console.log(`✅ ${branchCount} branches seeded across ${RESTAURANTS.length} restaurants.`);
}
