/**
 * The 5 restaurants (of the 20 in restaurant-data.ts) that get the full ERPH-2A enterprise
 * treatment: multiple branches, a real menu, staff roster, settings, and a spread of today's
 * orders for dashboard metrics. The remaining 15 get a single default branch only (see
 * 04-branches.seed.ts) so no restaurant is left with zero branches, matching the ERPH-2
 * investigation finding that 19 of 20 seeded restaurants previously had none at all.
 */
export const FLAGSHIP_RESTAURANT_SLUGS = [
  'paradise-biryani',
  'shah-ghouse',
  'mehfil',
  'kritunga',
  'pista-house',
] as const;
