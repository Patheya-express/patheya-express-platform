import {
  computeRedisRetryDelay,
  isRedisShuttingDown,
  markRedisShuttingDown,
  resetRedisShuttingDownForTests,
  REDIS_MAX_RECONNECT_ATTEMPTS,
  REDIS_MAX_RECONNECT_DELAY_MS,
} from './redis-retry-policy';

describe('redis-retry-policy', () => {
  afterEach(() => {
    resetRedisShuttingDownForTests();
  });

  describe('computeRedisRetryDelay', () => {
    it('returns 50ms for the first retry attempt', () => {
      expect(computeRedisRetryDelay(1)).toBe(50);
    });

    it('ramps linearly for a normal backoff sequence', () => {
      expect(computeRedisRetryDelay(2)).toBe(100);
      expect(computeRedisRetryDelay(5)).toBe(250);
      expect(computeRedisRetryDelay(10)).toBe(500);
    });

    it('caps the delay at REDIS_MAX_RECONNECT_DELAY_MS once the ramp exceeds it', () => {
      const attemptsAtCap = Math.ceil(REDIS_MAX_RECONNECT_DELAY_MS / 50);

      expect(computeRedisRetryDelay(attemptsAtCap)).toBe(
        REDIS_MAX_RECONNECT_DELAY_MS,
      );
      expect(computeRedisRetryDelay(attemptsAtCap + 10)).toBe(
        REDIS_MAX_RECONNECT_DELAY_MS,
      );
    });

    it('still returns a delay on the last attempt within the ceiling', () => {
      expect(
        computeRedisRetryDelay(REDIS_MAX_RECONNECT_ATTEMPTS),
      ).not.toBeNull();
    });

    it('returns null once the maximum retry attempt count is exceeded', () => {
      expect(
        computeRedisRetryDelay(REDIS_MAX_RECONNECT_ATTEMPTS + 1),
      ).toBeNull();
    });

    it('continues returning null for every attempt after the ceiling (no resurrection)', () => {
      expect(
        computeRedisRetryDelay(REDIS_MAX_RECONNECT_ATTEMPTS + 2),
      ).toBeNull();
      expect(computeRedisRetryDelay(9999)).toBeNull();
    });
  });

  describe('shutdown behavior', () => {
    it('is not shutting down by default', () => {
      expect(isRedisShuttingDown()).toBe(false);
    });

    it('stops issuing further reconnect delays once shutdown has been marked, even on attempt 1', () => {
      expect(computeRedisRetryDelay(1)).toBe(50);

      markRedisShuttingDown();

      expect(isRedisShuttingDown()).toBe(true);
      expect(computeRedisRetryDelay(1)).toBeNull();
      expect(computeRedisRetryDelay(2)).toBeNull();
    });

    it('is idempotent — marking shutdown multiple times has the same effect as once', () => {
      markRedisShuttingDown();
      markRedisShuttingDown();

      expect(isRedisShuttingDown()).toBe(true);
      expect(computeRedisRetryDelay(1)).toBeNull();
    });
  });
});
