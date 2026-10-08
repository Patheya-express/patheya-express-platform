/**
 * Deterministic synthetic catalogue for the production capacity test (loadtest/k6/README.md).
 *
 * Pure data — no database access — so it is unit-testable and `plan` can print the exact rows and
 * IDs before anything is written. Every ID is a name-based UUID (v5-style, SHA-1) derived from
 * DATASET_ID, so the same plan always yields the same IDs: the manifest is reproducible and cleanup
 * can target exact rows instead of pattern-matching.
 *
 * Every record is unmistakably synthetic: names start with `LOADTEST_`, slugs with `loadtest-`,
 * addresses say "not a real location", and the single owner account is `@loadtest.invalid` with no
 * password (it cannot log in).
 */
import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

export const DATASET_ID = 'LOADTEST_v1';
export const NAME_PREFIX = 'LOADTEST_';
export const SLUG_PREFIX = 'loadtest-';
export const OWNER_EMAIL = 'loadtest-owner@loadtest.invalid';
export const RESTAURANT_COUNT = 60;
export const DISHES_PER_CATEGORY = 8;
export const MARKER_DESCRIPTION =
  'Synthetic load-test record (LOADTEST_v1) — not a real business. Safe to delete.';

/** Name-based UUID (RFC 4122 v5 layout over SHA-1) — stable across runs. */
export function stableId(kind: string, key: string | number): string {
  const hex = createHash('sha1')
    .update(`${DATASET_ID}:${kind}:${key}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CITIES = [
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { city: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 },
  { city: 'Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
];

const CUISINES = [
  'North Indian',
  'South Indian',
  'Chinese',
  'Biryani',
  'Desserts',
  'Fast Food',
  'Street Food',
  'Beverages',
];

type Dish = { name: string; veg: boolean; vegan: boolean };
const d = (name: string, veg = true, vegan = false): Dish => ({
  name,
  veg,
  vegan,
});

const MENU: { category: string; dishes: Dish[] }[] = [
  {
    category: 'Starters',
    dishes: [
      d('Paneer Tikka'),
      d('Chicken 65', false),
      d('Veg Spring Roll', true, true),
      d('Gobi Manchurian', true, true),
      d('Chicken Kebab', false),
      d('Samosa', true, true),
      d('Fish Fry', false),
      d('Hara Bhara Kabab'),
      d('Chilli Paneer'),
      d('Mutton Seekh Kebab', false),
    ],
  },
  {
    category: 'Mains',
    dishes: [
      d('Chicken Biryani', false),
      d('Veg Biryani'),
      d('Paneer Butter Masala'),
      d('Butter Chicken', false),
      d('Dal Makhani'),
      d('Masala Dosa', true, true),
      d('Veg Thali'),
      d('Hakka Noodles', true, true),
      d('Margherita Pizza'),
      d('Chicken Burger', false),
    ],
  },
  {
    category: 'Breads & Rice',
    dishes: [
      d('Butter Naan'),
      d('Tandoori Roti', true, true),
      d('Jeera Rice', true, true),
      d('Veg Pulao'),
      d('Idli', true, true),
      d('Plain Dosa', true, true),
      d('Laccha Paratha'),
      d('Egg Fried Rice', false),
      d('Kulcha'),
      d('Curd Rice'),
    ],
  },
  {
    category: 'Desserts & Drinks',
    dishes: [
      d('Gulab Jamun'),
      d('Rasmalai'),
      d('Chocolate Cake'),
      d('Mango Lassi'),
      d('Filter Coffee'),
      d('Masala Chai'),
      d('Fresh Lime Soda', true, true),
      d('Kulfi'),
      d('Brownie'),
      d('Orange Juice', true, true),
    ],
  },
];

type WithId<T> = T & { id: string };

const pad = (n: number) => String(n).padStart(3, '0');

export function buildCataloguePlan() {
  const ownerUserId = stableId('user', OWNER_EMAIL);
  // No passwordHash: login requires one, so this account can never sign in.
  const owner = {
    id: ownerUserId,
    firstName: `${NAME_PREFIX}Owner`,
    lastName: 'Synthetic',
    email: OWNER_EMAIL,
    role: 'RESTAURANT_OWNER',
  } satisfies Prisma.UserCreateInput;

  const cuisines = CUISINES.map(
    (name): WithId<Prisma.CuisineCreateManyInput> => ({
      id: stableId('cuisine', name),
      name: `${NAME_PREFIX}${name}`,
    }),
  );

  const restaurants: WithId<Prisma.RestaurantCreateManyInput>[] = [];
  const restaurantCuisines: Prisma.RestaurantCuisineCreateManyInput[] = [];
  const branches: WithId<Prisma.RestaurantBranchCreateManyInput>[] = [];
  const operatingHours: WithId<Prisma.OperatingHourCreateManyInput>[] = [];
  const menuCategories: WithId<Prisma.MenuCategoryCreateManyInput>[] = [];
  const menuItems: WithId<Prisma.MenuItemCreateManyInput>[] = [];
  const offers: WithId<Prisma.OfferCreateManyInput>[] = [];

  for (let i = 1; i <= RESTAURANT_COUNT; i++) {
    const key = pad(i);
    const restaurantId = stableId('restaurant', key);
    const loc = CITIES[i % CITIES.length];

    const items: { veg: boolean; vegan: boolean }[] = [];
    MENU.forEach((section, c) => {
      const categoryId = stableId('category', `${key}-${c}`);
      menuCategories.push({
        id: categoryId,
        restaurantId,
        name: `${NAME_PREFIX}${section.category}`,
        sortOrder: c,
      });
      for (let k = 0; k < DISHES_PER_CATEGORY; k++) {
        const dish = section.dishes[(i + k) % section.dishes.length];
        items.push(dish);
        menuItems.push({
          id: stableId('item', `${key}-${c}-${k}`),
          categoryId,
          name: `${NAME_PREFIX}${dish.name}`,
          description: MARKER_DESCRIPTION,
          basePrice: (80 + ((i * 37 + c * 53 + k * 29) % 320)).toFixed(2),
          isVegetarian: dish.veg,
          isVegan: dish.vegan,
          isAvailable: true,
          preparationTime: 10 + ((i + k) % 25),
        });
      }
    });

    restaurants.push({
      id: restaurantId,
      ownerId: ownerUserId,
      name: `${NAME_PREFIX}Restaurant_${key}`,
      slug: `${SLUG_PREFIX}restaurant-${key}`,
      description: MARKER_DESCRIPTION,
      status: 'APPROVED',
      isActive: true,
      featured: i % 10 === 0,
      avgRating: Number((3.5 + (i % 14) / 10).toFixed(1)),
      ratingCount: 20 + ((i * 17) % 400),
      avgPreparationTimeMinutes: 12 + (i % 15),
      avgDeliveryTimeMinutes: 25 + (i % 20),
      hasVegOptions: items.some((x) => x.veg),
      hasVeganOptions: items.some((x) => x.vegan),
    });

    restaurantCuisines.push(
      { restaurantId, cuisineId: cuisines[i % cuisines.length].id },
      { restaurantId, cuisineId: cuisines[(i + 3) % cuisines.length].id },
    );

    const branchId = stableId('branch', key);
    branches.push({
      id: branchId,
      restaurantId,
      name: `${NAME_PREFIX}Branch_${key}`,
      addressLine1: 'LOADTEST synthetic address — not a real location',
      city: loc.city,
      state: loc.state,
      postalCode: '000000',
      latitude: Number((loc.lat + (((i * 7) % 11) - 5) * 0.01).toFixed(5)),
      longitude: Number((loc.lng + (((i * 5) % 11) - 5) * 0.01).toFixed(5)),
      timezone: 'Asia/Kolkata',
      deliveryRadiusKm: 8,
      isActive: true,
      isPrimary: true,
    });

    // Open all day, every day, so `openNow` filters and isOpenNow behave like a busy evening.
    for (let day = 0; day < 7; day++) {
      operatingHours.push({
        id: stableId('hours', `${key}-${day}`),
        branchId,
        dayOfWeek: day,
        opensAt: '00:00',
        closesAt: '23:59',
        isClosed: false,
      });
    }

    if (i % 3 === 0) {
      offers.push({
        id: stableId('offer', key),
        restaurantId,
        title: `${NAME_PREFIX}10% off (synthetic)`,
        description: MARKER_DESCRIPTION,
        type: 'PERCENTAGE_OFF',
        isActive: true,
      });
    }
  }

  return {
    owner,
    cuisines,
    restaurants,
    restaurantCuisines,
    branches,
    operatingHours,
    menuCategories,
    menuItems,
    offers,
  };
}

export type CataloguePlan = ReturnType<typeof buildCataloguePlan>;

/** Every ID the seed creates — printed by `plan` and after `seed`, and used by `cleanup`. */
export function manifestOf(plan: CataloguePlan) {
  return {
    dataset: DATASET_ID,
    counts: {
      users: 1,
      cuisines: plan.cuisines.length,
      restaurants: plan.restaurants.length,
      restaurantCuisines: plan.restaurantCuisines.length,
      branches: plan.branches.length,
      operatingHours: plan.operatingHours.length,
      menuCategories: plan.menuCategories.length,
      menuItems: plan.menuItems.length,
      offers: plan.offers.length,
    },
    ids: {
      ownerUserId: plan.owner.id,
      cuisineIds: plan.cuisines.map((x) => x.id),
      restaurantIds: plan.restaurants.map((x) => x.id),
      branchIds: plan.branches.map((x) => x.id),
      operatingHourIds: plan.operatingHours.map((x) => x.id),
      menuCategoryIds: plan.menuCategories.map((x) => x.id),
      menuItemIds: plan.menuItems.map((x) => x.id),
      offerIds: plan.offers.map((x) => x.id),
    },
  };
}
