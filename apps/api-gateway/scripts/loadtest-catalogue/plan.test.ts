/**
 * LOADTEST_ catalogue plan — run via `pnpm --filter api-gateway run test:loadtest-catalogue`
 * (`tsx --test`, Node's built-in runner; Jest only discovers specs under src/).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  NAME_PREFIX,
  OWNER_EMAIL,
  RESTAURANT_COUNT,
  SLUG_PREFIX,
  buildCataloguePlan,
  manifestOf,
  stableId,
} from './plan';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('LOADTEST_ catalogue plan', () => {
  const plan = buildCataloguePlan();
  const manifest = manifestOf(plan);

  test('is deterministic — identical IDs on every build', () => {
    assert.deepEqual(manifestOf(buildCataloguePlan()), manifest);
  });

  test('every ID is a well-formed, unique UUID', () => {
    const all = [
      manifest.ids.ownerUserId,
      ...Object.values(manifest.ids).filter(Array.isArray).flat(),
    ];
    for (const id of all) assert.match(id, UUID);
    assert.equal(new Set(all).size, all.length);
    assert.notEqual(
      stableId('restaurant', '001'),
      stableId('restaurant', '002'),
    );
  });

  test('every named record is clearly marked LOADTEST_', () => {
    const named = [
      plan.owner.firstName,
      ...plan.cuisines.map((x) => x.name),
      ...plan.restaurants.map((x) => x.name),
      ...plan.branches.map((x) => x.name),
      ...plan.menuCategories.map((x) => x.name),
      ...plan.menuItems.map((x) => x.name),
      ...plan.offers.map((x) => x.title),
    ];
    for (const name of named) assert.ok(name.startsWith(NAME_PREFIX), name);
    for (const r of plan.restaurants)
      assert.ok(r.slug.startsWith(SLUG_PREFIX), r.slug);
    for (const b of plan.branches)
      assert.match(b.addressLine1, /not a real location/);
  });

  test('owner cannot log in and is not privileged', () => {
    assert.equal(plan.owner.email, OWNER_EMAIL);
    assert.ok(OWNER_EMAIL.endsWith('.invalid'));
    assert.equal('passwordHash' in plan.owner, false);
    assert.equal(plan.owner.role, 'RESTAURANT_OWNER');
  });

  test('is small but representative', () => {
    assert.equal(plan.restaurants.length, RESTAURANT_COUNT);
    assert.ok(
      manifest.counts.menuItems >= 1000 && manifest.counts.menuItems <= 3000,
    );
    assert.ok(
      plan.restaurants.every((r) => r.status === 'APPROVED' && r.isActive),
    );
    assert.ok(plan.restaurants.some((r) => r.featured));
    assert.ok(new Set(plan.branches.map((b) => b.city)).size >= 5);
    // Every restaurant has a primary branch open all week, and only references planned rows.
    const restaurantIds = new Set(manifest.ids.restaurantIds);
    const cuisineIds = new Set(manifest.ids.cuisineIds);
    assert.ok(
      plan.branches.every(
        (b) => restaurantIds.has(b.restaurantId) && b.isPrimary,
      ),
    );
    assert.equal(plan.operatingHours.length, RESTAURANT_COUNT * 7);
    assert.ok(
      plan.restaurantCuisines.every(
        (l) => restaurantIds.has(l.restaurantId) && cuisineIds.has(l.cuisineId),
      ),
    );
    assert.ok(plan.restaurants.every((r) => r.ownerId === plan.owner.id));
  });
});
