/**
 * Sprint 1.6 — AppLoggerService previously spread every logged object into Winston verbatim, with
 * no field filtering at all. Nothing today actually logs a raw `Authorization` header or a
 * password field, but nothing PREVENTED it either — this is the safety net for the next call site
 * that does (e.g. a future `logger.error({ headers: req.headers })` or `logger.log({ ...dto })`
 * on a DTO that happens to carry a password/token field). Only redacts by KEY NAME — it cannot
 * catch a secret embedded in a free-text string message, which is a different (and much harder,
 * out-of-scope-for-this-sprint) problem; every logging call site in this codebase already passes
 * a structured object, not a pre-formatted string, so key-based redaction covers the actual
 * pattern in use.
 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|signature|cookie|api[-_]?key|private[-_]?key|client[-_]?secret)/i;

const REDACTED = '[REDACTED]';

/** Bounds both recursion depth (a deeply/adversarially nested object can't hang the logger) and
 *  cyclic references (an accidentally-logged Express req/res, Prisma model with a circular
 *  relation include, etc.) without ever throwing. */
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Error) &&
    !Buffer.isBuffer(value)
  );
}

/**
 * Returns a new value with every object key matching SENSITIVE_KEY_PATTERN replaced by a fixed
 * `[REDACTED]` marker, recursively. Every other field — including the ones that make logs
 * actually useful for debugging (requestId, userId, orderId, event names, status codes, etc.) —
 * passes through completely unchanged. Never mutates its input.
 */
export function redactSensitiveFields(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) {
    return '[MaxDepthExceeded]';
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    return value.map((item) => redactSensitiveFields(item, seen, depth + 1));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactSensitiveFields(val, seen, depth + 1);
    }

    return result;
  }

  return value;
}
