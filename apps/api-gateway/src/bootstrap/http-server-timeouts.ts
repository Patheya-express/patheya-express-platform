import type { Server } from 'http';

/**
 * Node's HTTP keep-alive vs the load balancer's idle timeout.
 *
 * The production ALB keeps idle connections to a target open for up to its idle timeout (300 s,
 * Terraform modules/alb) and reuses them for new requests. Node closes an idle keep-alive socket
 * after `server.keepAliveTimeout` (default 5 s). When Node closes a socket the ALB has just
 * picked for a request, the ALB answers 502 with no target status — seen 7 times during the
 * 2026-10-08 load test. AWS's guidance is for the target's keep-alive timeout to exceed the
 * load balancer's idle timeout, so the ALB, not the target, always closes idle connections.
 *
 * `headersTimeout` and `requestTimeout` are per request in Node 24 and are left at their
 * defaults. Graceful shutdown is unaffected: on Node >= 19 `server.close()` (Nest `app.close()`)
 * also closes idle keep-alive sockets, and ECS deregisters the task from the ALB before SIGTERM.
 */
export const DEFAULT_LB_IDLE_TIMEOUT_SECONDS = 300;

/** Margin above the load balancer idle timeout. */
export const KEEP_ALIVE_MARGIN_MS = 5_000;

export interface HttpServerTimeouts {
  keepAliveTimeoutMs: number;
}

function positiveInt(
  raw: string | undefined,
  name: string,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return value;
}

/**
 * LB_IDLE_TIMEOUT_SECONDS: the load balancer idle timeout in front of this process (default 300,
 * the production ALB). HTTP_KEEP_ALIVE_TIMEOUT_MS: explicit override; must still exceed the idle
 * timeout.
 */
export function resolveHttpServerTimeouts(
  env: NodeJS.ProcessEnv = process.env,
): HttpServerTimeouts {
  const idleSeconds =
    positiveInt(env.LB_IDLE_TIMEOUT_SECONDS, 'LB_IDLE_TIMEOUT_SECONDS') ??
    DEFAULT_LB_IDLE_TIMEOUT_SECONDS;
  const idleMs = idleSeconds * 1000;
  const override = positiveInt(
    env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    'HTTP_KEEP_ALIVE_TIMEOUT_MS',
  );

  if (override !== undefined && override <= idleMs) {
    throw new Error(
      `HTTP_KEEP_ALIVE_TIMEOUT_MS (${override}) must exceed the load balancer idle timeout ` +
        `(${idleMs} ms); otherwise the target closes connections the load balancer reuses (502).`,
    );
  }

  return { keepAliveTimeoutMs: override ?? idleMs + KEEP_ALIVE_MARGIN_MS };
}

export function applyHttpServerTimeouts(
  server: Pick<Server, 'keepAliveTimeout'>,
  timeouts: HttpServerTimeouts,
): void {
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
}
