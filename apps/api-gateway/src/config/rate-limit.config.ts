import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Global per-client-IP rate limit (ThrottlerGuard, APP_GUARD in app.module.ts).
 *
 * Normal production value is the default: 100 requests per 60 s window per client IP.
 * RATE_LIMIT_MAX overrides the request count only — the window stays 60 s, and per-route
 * `@Throttle()` limits (login 5/min, refresh 20/min, search log 30/min, ...) are unaffected.
 * The only intended non-default use is a temporary load-test deployment
 * (loadtest/k6/README.md "Rate-limit lifecycle"), which must be reverted to 100 afterwards.
 */
export const DEFAULT_RATE_LIMIT_MAX = 100;
export const RATE_LIMIT_MAX_UPPER_BOUND = 100_000;
export const RATE_LIMIT_TTL_MS = 60_000;

/**
 * Unset/blank → the default. Anything else must be an integer in [1, RATE_LIMIT_MAX_UPPER_BOUND];
 * an invalid value throws, so a typo fails the deployment at boot (ECS circuit breaker rolls back)
 * instead of silently running with an unintended limit. env.validation.ts enforces the same rule
 * earlier, with a clearer message.
 */
export function parseRateLimitMax(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_RATE_LIMIT_MAX;
  }
  const value = Number(raw.trim());
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > RATE_LIMIT_MAX_UPPER_BOUND
  ) {
    throw new Error(
      `RATE_LIMIT_MAX must be an integer between 1 and ${RATE_LIMIT_MAX_UPPER_BOUND} (got "${raw}")`,
    );
  }
  return value;
}

export function buildThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  return [
    {
      name: 'default',
      ttl: RATE_LIMIT_TTL_MS,
      limit: config.get<number>('rateLimit.max', DEFAULT_RATE_LIMIT_MAX),
    },
  ];
}
