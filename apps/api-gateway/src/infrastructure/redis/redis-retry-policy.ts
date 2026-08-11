/**
 * Bounded Redis reconnect policy (Phase 0 remediation).
 *
 * Previously `retryStrategy` was `(times) => Math.min(times * 50, 2000)` with no ceiling on the
 * number of attempts — a genuinely sustained Redis outage (e.g. an Upstash instance suspended for
 * exceeding its command budget) drove every connection in the process into retrying forever,
 * every ~2s, indefinitely. That is itself billable command volume (each attempt is a fresh
 * TCP+TLS handshake and AUTH round trip) and was flagged CRITICAL in the Phase 0 audit.
 *
 * This keeps the exact same ramp (50ms per attempt) and cap (2000ms) — both already tuned and
 * unrelated to the actual defect — and adds a maximum attempt count. Once exceeded, ioredis is
 * told to give up (a non-number return value ends the connection instead of scheduling another
 * retry): `RedisService`/BullMQ/the Socket.IO adapter then surface as disconnected, which the
 * existing health checks (`health.service.ts`'s `withTimeout`-wrapped `checkRedis()`,
 * `QueueService.checkHealth()`) already report as `degraded`/503 rather than hang.
 *
 * Reasoning for the default of 60 attempts: cumulative wait time before giving up is
 * sum(min(n*50, 2000)) for n=1..60 — the ramp reaches the 2000ms cap at attempt 40 (cumulative
 * ~41s), then 20 more attempts at the 2000ms cap add ~40s, for a total ride-out window of ~81
 * seconds. That's long enough to absorb a transient blip (Upstash's documented idle-connection
 * behavior, a brief network hiccup, a Redis failover) without the connection giving up
 * prematurely, while still being finite — a sustained outage stops generating reconnect traffic
 * after about a minute and a half instead of forever.
 *
 * Env-overridable (`REDIS_MAX_RECONNECT_ATTEMPTS`) following the same convention as
 * `SHUTDOWN_TIMEOUT_MS`, for an operator to tune without a code change if SG's observed behavior
 * calls for a different value.
 */
export const REDIS_MAX_RECONNECT_DELAY_MS = 2000;

export const REDIS_MAX_RECONNECT_ATTEMPTS =
  Number(process.env.REDIS_MAX_RECONNECT_ATTEMPTS) || 60;

/**
 * ioredis's `retryStrategy` return contract: a number schedules the next retry after that many
 * ms; `null`/`undefined` gives up and ends the connection permanently (no further `reconnecting`
 * events fire afterward).
 *
 * A tiny, dependency-free module-level flag rather than a NestJS provider — ioredis invokes
 * `retryStrategy` directly, with no DI container available, so the flag must be reachable via a
 * plain function call. Set by `main.ts`/`worker-main.ts` the moment a shutdown begins (signal or
 * fatal error), before Nest's own lifecycle hooks run, so any connection currently mid-backoff
 * stops retrying immediately instead of racing the shutdown sequence.
 */
let shuttingDown = false;

export function markRedisShuttingDown(): void {
  shuttingDown = true;
}

export function isRedisShuttingDown(): boolean {
  return shuttingDown;
}

/** Exposed for tests only — production code has no legitimate reason to "un-shut-down" a process. */
export function resetRedisShuttingDownForTests(): void {
  shuttingDown = false;
}

export function computeRedisRetryDelay(times: number): number | null {
  if (isRedisShuttingDown()) {
    return null;
  }

  if (times > REDIS_MAX_RECONNECT_ATTEMPTS) {
    return null;
  }

  return Math.min(times * 50, REDIS_MAX_RECONNECT_DELAY_MS);
}
