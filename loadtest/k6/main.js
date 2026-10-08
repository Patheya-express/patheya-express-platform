// Patheya Express API capacity test — see README.md before running anything.
//
//   k6 run --address 127.0.0.1:6565 -e PROFILE=ramp -e BASE_URL=https://api.patheyaexpress.com \
//          -e CONFIRM_PRODUCTION=I_UNDERSTAND main.js
//
// VUs are simulated active sessions (one browsing customer each, with think time) — NOT
// registered users and NOT concurrent app installs. See README "Workload model".

import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { Counter } from 'k6/metrics';
import {
  ALLOW_EMPTY_CATALOG,
  MAX_RPS,
  PROFILE,
  assertTargetAllowed,
  buildStages,
  buildThresholds,
  stageAt,
  toK6Stages,
} from './lib/config.js';
import { get, isReady, jwtExpiryEpochMs, login } from './lib/api.js';
import { BASE_SEARCH_TERMS, browse, pickJourney } from './lib/journeys.js';

// --- init-time safety gates (run before any request is sent) -----------------------------------

assertTargetAllowed(() => open('./results/preflight.json'));
const STAGES = buildStages();

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: toK6Stages(STAGES),
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  // Global request-rate ceiling across all VUs. If http_reqs rate sits AT this value the result
  // is client-limited, not a capacity finding — raise MAX_RPS (hard cap 1000) and re-run.
  rps: MAX_RPS,
  thresholds: buildThresholds(STAGES),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '2m',
  userAgent: 'patheya-loadtest/1.0 (k6)',
  tags: { testid: `${PROFILE}-${new Date().toISOString().slice(0, 16)}` },
};

const journeyIterations = new Counter('journey_iterations');
const authFallbacks = new Counter('auth_fallbacks');

// --- setup: one readiness check, catalogue discovery, optional single login --------------------

export function setup() {
  if (!isReady()) throw new Error('GET /api/v1/health/ready is not 200 — refusing to start');

  const restaurants = [];
  for (let page = 1; page <= 3; page++) {
    const data = get('GET /restaurants', '/restaurants', { page, limit: 100 });
    if (!data || !data.items || !data.items.length) break;
    for (const r of data.items) restaurants.push({ id: r.id, name: r.name, city: r.city, cuisines: r.cuisines || [] });
    if (page >= data.totalPages) break;
  }
  if (!restaurants.length && !ALLOW_EMPTY_CATALOG) {
    throw new Error(
      'Catalogue is empty (GET /restaurants returned no items). Results against empty tables ' +
        'overstate capacity. Seed a representative synthetic catalogue first, or set ' +
        'ALLOW_EMPTY_CATALOG=true for a route-validation-only run.',
    );
  }

  const cuisineData = get('GET /cuisines', '/cuisines') || [];
  const cuisines = cuisineData.map((c) => c.name).filter(Boolean);
  const cities = [...new Set(restaurants.map((r) => r.city).filter(Boolean))];
  const searchTerms = [
    ...BASE_SEARCH_TERMS,
    ...cuisines.map((c) => c.toLowerCase()),
    ...restaurants.slice(0, 50).map((r) => r.name.split(' ')[0].toLowerCase()),
  ].filter((t) => t && t.length >= 2);

  let token = null;
  let tokenExpiresAt = 0;
  if (__ENV.LT_EMAIL && __ENV.LT_PASSWORD) {
    token = login(__ENV.LT_EMAIL, __ENV.LT_PASSWORD);
    tokenExpiresAt = jwtExpiryEpochMs(token);
  }

  console.log(
    `setup: profile=${PROFILE} restaurants=${restaurants.length} cuisines=${cuisines.length} ` +
      `cities=${cities.length} searchTerms=${searchTerms.length} auth=${token ? 'yes' : 'no'} maxRps=${MAX_RPS}`,
  );
  return { restaurants, cuisines, cities, searchTerms, token, tokenExpiresAt };
}

// --- one iteration = one journey of one simulated session --------------------------------------

export default function (ctx) {
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  exec.vu.metrics.tags.stage = stageAt(STAGES, elapsed);

  const journey = pickJourney();
  exec.vu.metrics.tags.journey = journey.name;

  // The shared access token lives 15 minutes and cannot be refreshed safely across VUs (refresh
  // rotates it). Stop using it a minute early and fall back to anonymous browsing.
  const token = ctx.token && Date.now() < ctx.tokenExpiresAt - 60000 ? ctx.token : null;
  if (journey.auth && !token) {
    authFallbacks.add(1);
    browse(ctx);
  } else {
    journey.run(ctx, token);
  }
  journeyIterations.add(1);
}

// --- summary: per-stage capacity table + full JSON for the report ------------------------------

function fmt(v) {
  return v === undefined ? '-' : Math.round(v).toString();
}

export function handleSummary(data) {
  // setup_data carries the shared JWT — it must never reach stdout or a results file.
  delete data.setup_data;

  const rows = [];
  for (const s of STAGES) {
    const dur = data.metrics[`http_req_duration{stage:${s.name}}`];
    const reqs = data.metrics[`http_reqs{stage:${s.name}}`];
    const failed = data.metrics[`http_req_failed{stage:${s.name}}`];
    if (!dur || !reqs || !reqs.values.count) continue;
    const rps = reqs.values.count / (s.rampSeconds + s.holdSeconds);
    rows.push(
      `${s.name.padEnd(10)} ${String(s.target).padStart(5)} ${rps.toFixed(1).padStart(8)} ` +
        `${fmt(dur.values.med).padStart(7)} ${fmt(dur.values['p(95)']).padStart(7)} ` +
        `${fmt(dur.values['p(99)']).padStart(7)} ${((failed ? failed.values.rate : 0) * 100).toFixed(2).padStart(7)}%`,
    );
  }
  const table =
    '\nPer-stage results (latency ms; rps averaged over ramp+hold)\n' +
    'stage        VUs      rps     p50     p95     p99   errors\n' +
    rows.join('\n') +
    `\n\nthrottled(429) rate: ${((data.metrics.throttled?.values.rate || 0) * 100).toFixed(2)}%` +
    `  auth fallbacks: ${data.metrics.auth_fallbacks?.values.count || 0}\n`;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }) + table,
    [`results/${PROFILE}-${stamp}.json`]: JSON.stringify(data, null, 2),
    [`results/${PROFILE}-${stamp}.txt`]: table,
  };
}
