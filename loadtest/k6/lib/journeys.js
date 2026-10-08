// Weighted user journeys built ONLY from real, read-only api-gateway routes. Each journey is one
// short "visit" of a simulated session: a few page views separated by human think time.
//
// No journey calls an endpoint that creates orders, payments, cart items, reviews, search logs,
// tickets or any other state. The one write side effect is GET /cart's findOrCreateCart, which
// inserts a single empty cart row for the load-test account on its first call and is a pure read
// afterwards.

import { sleep } from 'k6';
import { get } from './api.js';

// Static query vocabulary for search — common Indian food-delivery terms, merged at setup() with
// real restaurant and cuisine names from the catalogue.
export const BASE_SEARCH_TERMS = [
  'biryani', 'pizza', 'dosa', 'idli', 'paneer', 'burger', 'chicken', 'thali',
  'noodles', 'coffee', 'shawarma', 'momos', 'pulao', 'kebab', 'cake', 'juice',
];

// City centres for the home screen's nearby/recommended sections.
const COORDINATES = [
  { lat: 17.385, lng: 78.4867 }, // Hyderabad
  { lat: 12.9716, lng: 77.5946 }, // Bengaluru
  { lat: 13.0827, lng: 80.2707 }, // Chennai
  { lat: 19.076, lng: 72.8777 }, // Mumbai
  { lat: 28.6139, lng: 77.209 }, // Delhi
];

const SORTS = ['popularity', 'rating', 'deliveryTime', 'name'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;
// Human think time between page views (seconds).
const think = (min = 1, max = 3) => sleep(min + Math.random() * (max - min));

// 35% — home screen, then the restaurant listing with realistic filter/sort/paging.
export function browse(ctx) {
  const coords = chance(0.8) ? pick(COORDINATES) : {};
  get('GET /customer/home', '/customer/home', coords);
  think();

  const qs = {
    page: chance(0.75) ? 1 : 2,
    limit: 20,
    sortBy: pick(SORTS),
    sortOrder: 'desc',
  };
  if (chance(0.3) && ctx.cuisines.length) qs.cuisine = pick(ctx.cuisines);
  if (chance(0.2) && ctx.cities.length) qs.city = pick(ctx.cities);
  if (chance(0.15)) qs.veg = 'true';
  if (chance(0.15)) qs.openNow = 'true';
  get('GET /restaurants', '/restaurants', qs);
  think();
}

// 20% — autocomplete while typing, then a full search; sometimes the paginated dish search.
export function search(ctx) {
  const term = pick(ctx.searchTerms);
  const typed = Math.min(term.length, 2 + Math.floor(Math.random() * 3));
  for (let n = 2; n <= typed; n++) {
    get('GET /search/suggestions', '/search/suggestions', { q: term.slice(0, n), limit: 8 });
    sleep(0.3 + Math.random() * 0.4); // typing cadence
  }
  get('GET /search/global', '/search/global', { q: term, limit: 10 });
  think();
  if (chance(0.3)) {
    get('GET /search/menu-items', '/search/menu-items', { q: term, page: 1, limit: 20 });
    think();
  }
}

// 15% — open one restaurant: profile, full menu, reviews, offers.
export function restaurantDetail(ctx) {
  if (!ctx.restaurants.length) return browse(ctx);
  const r = pick(ctx.restaurants);
  get('GET /restaurants/:id', `/restaurants/${r.id}`);
  get('GET /menu/:restaurantId', `/menu/${r.id}`);
  think(2, 5); // reading the menu
  if (chance(0.5)) {
    get('GET /restaurants/:id/reviews', `/restaurants/${r.id}/reviews`, { page: 1, limit: 10 });
    think();
  }
  if (chance(0.4)) {
    get('GET /offers/restaurants/:restaurantId', `/offers/restaurants/${r.id}`, { page: 1, limit: 10 });
  }
  if (chance(0.3)) {
    get('GET /restaurants/:restaurantId/branches', `/restaurants/${r.id}/branches`);
  }
  think();
}

// 10% — signed-in account pages (needs LT_EMAIL/LT_PASSWORD; otherwise counted as browse).
export function account(ctx, token) {
  if (!token) return browse(ctx);
  get('GET /users/me', '/users/me', null, token);
  get('GET /notifications/me/unread-count', '/notifications/me/unread-count', null, token);
  think();
  get('GET /orders/me', '/orders/me', { page: 1, limit: 10 }, token);
  think();
  if (chance(0.4)) {
    get('GET /wallet/balance', '/wallet/balance', null, token);
    think();
  }
}

// 10% — signed-in cart/checkout-adjacent reads (no cart mutation).
export function cartRead(ctx, token) {
  if (!token) return browse(ctx);
  get('GET /cart', '/cart', null, token);
  think();
  get('GET /addresses', '/addresses', null, token);
  const restaurantId = ctx.restaurants.length && chance(0.5) ? pick(ctx.restaurants).id : undefined;
  get('GET /coupons/available', '/coupons/available', { restaurantId }, token);
  think();
  if (chance(0.3)) {
    get('GET /favorites/restaurants', '/favorites/restaurants', null, token);
    think();
  }
}

// 10% — other public reads: cuisines, offers, trending, FAQs.
export function otherReads() {
  const roll = Math.random();
  if (roll < 0.3) get('GET /cuisines', '/cuisines');
  else if (roll < 0.55) get('GET /offers/featured', '/offers/featured');
  else if (roll < 0.75) get('GET /offers/home', '/offers/home');
  else if (roll < 0.9) get('GET /search/trending', '/search/trending');
  else get('GET /faqs', '/faqs');
  think();
}

// Cumulative weights — must sum to 1.
export const JOURNEYS = [
  { name: 'browse', weight: 0.35, run: browse, auth: false },
  { name: 'search', weight: 0.2, run: search, auth: false },
  { name: 'restaurant_detail', weight: 0.15, run: restaurantDetail, auth: false },
  { name: 'account', weight: 0.1, run: account, auth: true },
  { name: 'cart_read', weight: 0.1, run: cartRead, auth: true },
  { name: 'other_reads', weight: 0.1, run: otherReads, auth: false },
];

export function pickJourney() {
  let roll = Math.random();
  for (const j of JOURNEYS) {
    if ((roll -= j.weight) < 0) return j;
  }
  return JOURNEYS[0];
}
