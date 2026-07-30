import jwt from 'jsonwebtoken';

import { io } from 'socket.io-client';

/**
 * Post-deployment smoke test (Production Readiness Stage A — Deployment Safety). Run against an
 * *already-deployed, running* instance (not booted in-process like `docs:export`) right after a
 * deploy, so a broken release fails fast instead of silently serving degraded traffic. Exits 1 if
 * any check fails — wire this into the deploy pipeline as a required step immediately after
 * rollout, before routing real traffic to the new revision.
 *
 * Env vars:
 *  - SMOKE_TEST_BASE_URL (default http://localhost:3000) — the deployed instance to test.
 *  - SMOKE_TEST_TIMEOUT_MS (default 5000) — per-check timeout.
 *  - JWT_ACCESS_SECRET — same secret the deployed instance validates websocket tokens with;
 *    required only for the websocket check (used to *locally sign* a throwaway token, never sent
 *    to any endpoint) — skipped if absent.
 *  - SMOKE_TEST_RESTAURANT_ID / SMOKE_TEST_MENU_ITEM_ID / SMOKE_TEST_CUSTOMER_TOKEN /
 *    SMOKE_TEST_ADDRESS_ID — a dedicated smoke-test restaurant/menu-item/customer account and
 *    saved address. The checkout check is skipped, not failed, unless every one of these is
 *    provided — deliberately opt-in, since running it writes a real order into the database.
 *    Provisioning and (if desired) auto-cancelling that order afterward is an infrastructure
 *    decision for whoever operates this pipeline, not something this script assumes.
 */

const BASE_URL = process.env.SMOKE_TEST_BASE_URL || 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const TIMEOUT_MS = Number(process.env.SMOKE_TEST_TIMEOUT_MS) || 5000;

type CheckOutcome = { status: 'pass' | 'fail' | 'skipped'; detail?: string };
type CheckResult = CheckOutcome & { name: string; durationMs: number };

async function withTimeout(promise: Promise<CheckOutcome>): Promise<CheckOutcome> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<CheckOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: 'fail', detail: `timed out after ${TIMEOUT_MS}ms` }),
      TIMEOUT_MS,
    );
  });

  const result = await Promise.race([promise, timeout]);

  clearTimeout(timer!);

  return result;
}

async function runCheck(
  name: string,
  fn: () => Promise<CheckOutcome>,
): Promise<CheckResult> {
  const start = Date.now();

  try {
    const outcome = await withTimeout(fn());

    return { name, ...outcome, durationMs: Date.now() - start };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    };
  }
}

interface HealthPayload {
  status?: string;
  database?: string;
  redis?: string;
  queues?: string;
  storage?: string;
}

/** `ResponseInterceptor` (`core/interceptors/response.interceptor.ts`) wraps every JSON response
 *  in `{ success, timestamp, data }` — the actual health payload is at `body.data`, not the
 *  top level. Verified against a real running instance (a first version of this script read
 *  `body.status` directly and always reported a false failure). */
function unwrapEnvelope<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data;
  }

  return body as T;
}

async function checkLiveness(): Promise<CheckOutcome> {
  const res = await fetch(`${API}/health/live`);

  if (!res.ok) {
    return { status: 'fail', detail: `HTTP ${res.status}` };
  }

  const body = unwrapEnvelope<HealthPayload>(await res.json());

  if (body.status !== 'ok') {
    return { status: 'fail', detail: `unexpected body: ${JSON.stringify(body)}` };
  }

  return { status: 'pass' };
}

async function checkReadiness(): Promise<CheckOutcome> {
  const res = await fetch(`${API}/health/ready`);

  const body = unwrapEnvelope<HealthPayload>(await res.json());

  if (!res.ok || body.status !== 'ok') {
    return {
      status: 'fail',
      detail: `HTTP ${res.status} — database=${body.database}, redis=${body.redis}, queues=${body.queues}, storage=${body.storage}`,
    };
  }

  return {
    status: 'pass',
    detail: `database=${body.database}, redis=${body.redis}, queues=${body.queues}, storage=${body.storage}`,
  };
}

/** A protected endpoint called with no `Authorization` header must reject with 401 — proves the
 *  auth guard chain is actually wired up and enforcing, not merely that the process is running. */
async function checkAuthenticationEnforced(): Promise<CheckOutcome> {
  const res = await fetch(`${API}/users/me`);

  if (res.status !== 401) {
    return { status: 'fail', detail: `expected 401, got ${res.status}` };
  }

  return { status: 'pass' };
}

/** No real user/DB row needed: `RealtimeGateway.handleConnection` only verifies the JWT signature
 *  and claims, no database lookup — so a locally-signed, throwaway token is sufficient to prove
 *  the Socket.IO server (and its Redis adapter) accepts a real connection end-to-end. */
async function checkWebsocketConnection(): Promise<CheckOutcome> {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    return { status: 'skipped', detail: 'JWT_ACCESS_SECRET not provided' };
  }

  const token = jwt.sign(
    { sub: 'smoke-test-user', role: 'CUSTOMER' },
    secret,
    { expiresIn: '1m' },
  );

  return new Promise<CheckOutcome>((resolve) => {
    const socket = io(BASE_URL, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: TIMEOUT_MS,
    });

    socket.on('connect', () => {
      socket.disconnect();
      resolve({ status: 'pass' });
    });

    socket.on('connect_error', (error) => {
      resolve({ status: 'fail', detail: error.message });
    });
  });
}

/** Deliberately opt-in — see the module doc comment above. Skipped (not failed) unless a
 *  dedicated smoke-test restaurant/menu-item/customer/address is configured, since running it
 *  writes a real order. */
async function checkCheckoutFlow(): Promise<CheckOutcome> {
  const restaurantId = process.env.SMOKE_TEST_RESTAURANT_ID;
  const menuItemId = process.env.SMOKE_TEST_MENU_ITEM_ID;
  const customerToken = process.env.SMOKE_TEST_CUSTOMER_TOKEN;
  const addressId = process.env.SMOKE_TEST_ADDRESS_ID;

  if (!restaurantId || !menuItemId || !customerToken || !addressId) {
    return {
      status: 'skipped',
      detail:
        'SMOKE_TEST_RESTAURANT_ID / SMOKE_TEST_MENU_ITEM_ID / SMOKE_TEST_CUSTOMER_TOKEN / SMOKE_TEST_ADDRESS_ID not configured',
    };
  }

  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      restaurantId,
      addressId,
      paymentMode: 'ONLINE',
      items: [{ menuItemId, quantity: 1 }],
      idempotencyKey: crypto.randomUUID(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();

    return { status: 'fail', detail: `HTTP ${res.status}: ${body}` };
  }

  return { status: 'pass' };
}

async function main(): Promise<void> {
  console.log(`Running smoke tests against ${BASE_URL} ...\n`);

  const results = await Promise.all([
    runCheck('health:live', checkLiveness),
    runCheck('health:ready (database, redis, queues, storage)', checkReadiness),
    runCheck('auth:enforced', checkAuthenticationEnforced),
    runCheck('websocket:connect', checkWebsocketConnection),
    runCheck('checkout:flow', checkCheckoutFlow),
  ]);

  for (const result of results) {
    const icon = result.status === 'pass' ? '✔' : result.status === 'skipped' ? '○' : '✘';

    console.log(
      `${icon} ${result.name} (${result.durationMs}ms)${result.detail ? ` — ${result.detail}` : ''}`,
    );
  }

  const failed = results.filter((result) => result.status === 'fail');

  // `process.exitCode` (not `process.exit()`): lets Node drain its own event loop naturally —
  // forcing an immediate exit while `socket.io-client`'s WebSocket transport is still tearing
  // down its handles crashed with a libuv assertion during verification of this script.
  if (failed.length > 0) {
    console.error(`\nSmoke test FAILED: ${failed.length}/${results.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nSmoke test PASSED (${results.filter((r) => r.status === 'skipped').length} check(s) skipped).`,
  );
  process.exitCode = 0;
}

void main();
