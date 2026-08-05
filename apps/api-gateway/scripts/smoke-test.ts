import jwt from 'jsonwebtoken';

import { io } from 'socket.io-client';

import { Queue } from 'bullmq';

import { getRedisConnectionOptions } from '../src/infrastructure/redis/redis-connection.config';

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
 *  - REDIS_HOST / REDIS_PORT / REDIS_AUTH_TOKEN / REDIS_TLS — same Redis the deployed instance
 *    itself connects to (this script must run somewhere with network access to it — e.g. inside
 *    the cluster, not from an operator's laptop against a production instance). Required only for
 *    the queue/worker check; skipped if REDIS_HOST is absent, since not every place this script
 *    runs from necessarily has Redis reachability (Render's shell, for instance).
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

/** Verifies `/metrics` returns real Prometheus exposition text, not the standard
 *  `{success,timestamp,data}` envelope `ResponseInterceptor` applies to every other JSON route —
 *  a regression guard for exactly the bug this Stage B pass found live: the interceptor originally
 *  had no exclusion for `/metrics`, so a real Prometheus server could never actually scrape this
 *  endpoint (its exposition-format parser has no notion of a JSON wrapper). */
async function checkMetricsEndpoint(): Promise<CheckOutcome> {
  const res = await fetch(`${BASE_URL}/metrics`);

  if (!res.ok) {
    return { status: 'fail', detail: `HTTP ${res.status}` };
  }

  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('text/plain')) {
    return {
      status: 'fail',
      detail: `expected text/plain content-type, got "${contentType}"`,
    };
  }

  const body = await res.text();

  if (body.trimStart().startsWith('{')) {
    return {
      status: 'fail',
      detail: 'body looks JSON-wrapped, not raw Prometheus exposition text',
    };
  }

  const requiredMetrics = [
    'patheya_http_requests_total',
    'patheya_bullmq_queue_depth',
    'patheya_redis_active_connections',
  ];

  const missing = requiredMetrics.filter(
    (name) => !body.includes(`# TYPE ${name} `),
  );

  if (missing.length > 0) {
    return { status: 'fail', detail: `missing metrics: ${missing.join(', ')}` };
  }

  return { status: 'pass' };
}

/** Proves the BullMQ queue/worker pipeline is actually alive end-to-end — not just that Redis is
 *  reachable (which `/health/ready` already checks), but that a real Worker process is consuming
 *  jobs and a real processor is executing them. Reuses `dispatch-reconciliation`, an
 *  already-existing, already-idempotent, read-only job (`DispatchReconciliationService` re-scans
 *  for stranded orders and no-ops if none are found) — deliberately not a new job type, so this
 *  check adds zero new business logic or queue surface. Skipped if `REDIS_HOST` isn't set, since
 *  this script may run somewhere without direct Redis network access. */
async function checkQueueWorkerProcessing(): Promise<CheckOutcome> {
  if (!process.env.REDIS_HOST) {
    return { status: 'skipped', detail: 'REDIS_HOST not provided' };
  }

  const queue = new Queue('dispatch', {
    connection: getRedisConnectionOptions(),
  });

  try {
    const jobId = `smoke-test-dispatch-reconciliation-${Date.now()}`;

    const job = await queue.add(
      'dispatch-reconciliation',
      {},
      { jobId },
    );

    const pollIntervalMs = 200;
    const deadline = Date.now() + TIMEOUT_MS;

    while (Date.now() < deadline) {
      const state = await job.getState();

      if (state === 'completed') {
        return { status: 'pass', detail: `job ${jobId} completed` };
      }

      if (state === 'failed') {
        return {
          status: 'fail',
          detail: `job ${jobId} failed: ${job.failedReason}`,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      status: 'fail',
      detail: `job ${jobId} did not complete within ${TIMEOUT_MS}ms — no Worker consuming the "dispatch" queue?`,
    };
  } finally {
    await queue.close();
  }
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
    runCheck('metrics:endpoint', checkMetricsEndpoint),
    runCheck('queue:dispatch-reconciliation-processed', checkQueueWorkerProcessing),
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
