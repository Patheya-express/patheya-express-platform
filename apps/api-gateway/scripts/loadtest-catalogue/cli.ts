/**
 * LOADTEST_ synthetic catalogue — seed / cleanup / status / plan.
 *
 *   plan                              print the deterministic manifest; no DB access
 *   status                            count LOADTEST_ rows (read-only)
 *   seed    --confirm=LOADTEST_SEED   create the dataset in one transaction
 *   cleanup --confirm=LOADTEST_CLEANUP delete ONLY the dataset, in one transaction
 *
 * Local:       pnpm --filter api-gateway exec tsx scripts/loadtest-catalogue/cli.ts <cmd>
 * Production:  one-off ECS task on the API image (DATABASE_URL injected from Secrets Manager) —
 *              `node dist/scripts/loadtest-catalogue/cli.js <cmd>`; see loadtest/k6/README.md.
 *
 * Never prints DATABASE_URL — only its host and database name.
 */
import { PrismaClient } from '@prisma/client';

import {
  DATASET_ID,
  NAME_PREFIX,
  OWNER_EMAIL,
  SLUG_PREFIX,
  buildCataloguePlan,
  manifestOf,
} from './plan';

const SEED_CONFIRMATION = '--confirm=LOADTEST_SEED';
const CLEANUP_CONFIRMATION = '--confirm=LOADTEST_CLEANUP';
const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  return `${url.hostname}${url.pathname}`;
}

async function status(
  prisma: PrismaClient,
  ids: ReturnType<typeof manifestOf>['ids'],
) {
  const [owner, restaurants, prefixedRestaurants, cuisines, items, orders] =
    await Promise.all([
      prisma.user.count({ where: { id: ids.ownerUserId } }),
      prisma.restaurant.count({ where: { id: { in: ids.restaurantIds } } }),
      prisma.restaurant.count({
        where: {
          OR: [
            { name: { startsWith: NAME_PREFIX } },
            { slug: { startsWith: SLUG_PREFIX } },
          ],
        },
      }),
      prisma.cuisine.count({ where: { id: { in: ids.cuisineIds } } }),
      prisma.menuItem.count({ where: { id: { in: ids.menuItemIds } } }),
      prisma.order.count({
        where: { restaurantId: { in: ids.restaurantIds } },
      }),
    ]);
  return { owner, restaurants, prefixedRestaurants, cuisines, items, orders };
}

async function seed(prisma: PrismaClient) {
  const plan = buildCataloguePlan();
  const manifest = manifestOf(plan);

  await prisma.$transaction(async (tx) => {
    // Refuse to touch anything if any part of the dataset — or anything that looks like it —
    // already exists. Seeding never updates or reuses existing rows.
    const conflicts = await Promise.all([
      tx.user.count({
        where: { OR: [{ id: plan.owner.id }, { email: OWNER_EMAIL }] },
      }),
      tx.restaurant.count({
        where: {
          OR: [
            { id: { in: manifest.ids.restaurantIds } },
            { slug: { startsWith: SLUG_PREFIX } },
            { name: { startsWith: NAME_PREFIX } },
          ],
        },
      }),
      tx.cuisine.count({
        where: {
          OR: [
            { id: { in: manifest.ids.cuisineIds } },
            { name: { startsWith: NAME_PREFIX } },
          ],
        },
      }),
    ]);
    if (conflicts.some((n) => n > 0)) {
      throw new Error(
        `LOADTEST_ data already exists (owner/restaurants/cuisines = ${conflicts.join('/')}). ` +
          'Run `status`, then `cleanup` if it is a leftover, before seeding again.',
      );
    }

    await tx.user.create({ data: plan.owner });
    await tx.cuisine.createMany({ data: plan.cuisines });
    await tx.restaurant.createMany({ data: plan.restaurants });
    await tx.restaurantCuisine.createMany({ data: plan.restaurantCuisines });
    await tx.restaurantBranch.createMany({ data: plan.branches });
    await tx.operatingHour.createMany({ data: plan.operatingHours });
    await tx.menuCategory.createMany({ data: plan.menuCategories });
    await tx.menuItem.createMany({ data: plan.menuItems });
    await tx.offer.createMany({ data: plan.offers });
  }, TX_OPTIONS);

  return manifest;
}

async function cleanup(prisma: PrismaClient) {
  const { ids } = manifestOf(buildCataloguePlan());

  return prisma.$transaction(async (tx) => {
    const owned = await tx.restaurant.findMany({
      where: { ownerId: ids.ownerUserId },
      select: { id: true, name: true, slug: true },
    });
    const planned = new Set(ids.restaurantIds);
    const foreign = owned.filter(
      (r) =>
        !planned.has(r.id) ||
        !r.name.startsWith(NAME_PREFIX) ||
        !r.slug.startsWith(SLUG_PREFIX),
    );
    if (foreign.length) {
      throw new Error(
        `The LOADTEST_ owner owns ${foreign.length} restaurant(s) outside the dataset — aborting, nothing deleted.`,
      );
    }

    const orders = await tx.order.count({
      where: { restaurantId: { in: ids.restaurantIds } },
    });
    if (orders) {
      throw new Error(
        `${orders} order(s) reference LOADTEST_ restaurants — aborting, nothing deleted.`,
      );
    }

    // Deleting a cuisine cascades its join rows; never let that reach a real restaurant.
    const realLinks = await tx.restaurantCuisine.count({
      where: {
        cuisineId: { in: ids.cuisineIds },
        restaurantId: { notIn: ids.restaurantIds },
      },
    });
    if (realLinks) {
      throw new Error(
        `${realLinks} non-LOADTEST restaurant(s) are linked to LOADTEST_ cuisines — aborting, nothing deleted.`,
      );
    }

    // Exact IDs AND the name/slug marker must both match for every row deleted.
    const restaurants = await tx.restaurant.deleteMany({
      where: {
        id: { in: ids.restaurantIds },
        name: { startsWith: NAME_PREFIX },
        slug: { startsWith: SLUG_PREFIX },
      },
    });
    const cuisines = await tx.cuisine.deleteMany({
      where: { id: { in: ids.cuisineIds }, name: { startsWith: NAME_PREFIX } },
    });
    const users = await tx.user.deleteMany({
      where: {
        id: ids.ownerUserId,
        email: OWNER_EMAIL,
        role: 'RESTAURANT_OWNER',
      },
    });
    return {
      deleted: {
        restaurants: restaurants.count,
        cuisines: cuisines.count,
        users: users.count,
      },
      cascaded:
        'branches, operating hours, menu categories, menu items, cuisine links, offers',
    };
  }, TX_OPTIONS);
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);

  if (command === 'plan') {
    console.log(JSON.stringify(manifestOf(buildCataloguePlan()), null, 2));
    return;
  }
  if (!['status', 'seed', 'cleanup'].includes(command)) {
    throw new Error(
      'Usage: cli <plan|status|seed --confirm=LOADTEST_SEED|cleanup --confirm=LOADTEST_CLEANUP>',
    );
  }
  if (command === 'seed' && !flags.includes(SEED_CONFIRMATION)) {
    throw new Error(`seed requires ${SEED_CONFIRMATION}`);
  }
  if (command === 'cleanup' && !flags.includes(CLEANUP_CONFIRMATION)) {
    throw new Error(`cleanup requires ${CLEANUP_CONFIRMATION}`);
  }

  console.log(`${DATASET_ID} ${command} -> ${describeTarget()}`);
  const prisma = new PrismaClient();
  try {
    const { ids } = manifestOf(buildCataloguePlan());
    if (command === 'status') {
      console.log(JSON.stringify(await status(prisma, ids)));
    } else if (command === 'seed') {
      const manifest = await seed(prisma);
      // One line so it lands as a single CloudWatch log event — this is the record of every ID.
      console.log(`LOADTEST_MANIFEST ${JSON.stringify(manifest)}`);
      console.log(`after seed: ${JSON.stringify(await status(prisma, ids))}`);
    } else {
      console.log(JSON.stringify(await cleanup(prisma)));
      console.log(
        `after cleanup: ${JSON.stringify(await status(prisma, ids))}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
