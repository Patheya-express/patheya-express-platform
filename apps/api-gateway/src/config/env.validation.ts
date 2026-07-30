import * as Joi from 'joi';

/**
 * Case-insensitive substrings that indicate an unedited placeholder value was copied straight
 * from .env.example / .env.qa.example rather than replaced with a real secret — e.g.
 * "replace-with-a-long-random-value" is the literal text both example files ship for
 * JWT_ACCESS_SECRET. Checked against every secret-shaped field in EVERY environment (including
 * development) via rejectPlaceholder() below — a placeholder is never intentionally correct
 * anywhere, unlike minimum-length/known-weak-value checks, which are only enforced in production
 * (see productionSecret()) so local development stays convenient.
 */
const PLACEHOLDER_SUBSTRINGS = [
  'replace-with',
  'replace_with',
  'changeme',
  'change-me',
  'change_me',
  'your-secret',
  'your_secret',
  'insert-secret',
  'secret-here',
  'xxxxxxxx',
];

/** Literal values that are non-empty but are exactly the kind of "typed something to get past
 *  validation" value a real production secret must never be. Only enforced in production —
 *  several of these (e.g. "test") are legitimate, intentional local/CI convenience values. */
const KNOWN_WEAK_VALUES = new Set([
  'secret',
  'password',
  'test',
  'dev',
  'development',
  'admin',
  'admin123',
  '123456',
  'letmein',
  'qwerty',
]);

function containsPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_SUBSTRINGS.some((pattern) => lower.includes(pattern));
}

function rejectPlaceholder(value: string, helpers: Joi.CustomHelpers) {
  if (containsPlaceholder(value)) {
    return helpers.error('secret.placeholder');
  }
  return value;
}

function rejectKnownWeakValue(value: string, helpers: Joi.CustomHelpers) {
  if (KNOWN_WEAK_VALUES.has(value.toLowerCase())) {
    return helpers.error('secret.weak');
  }
  return value;
}

const PLACEHOLDER_MESSAGES = {
  'secret.placeholder':
    '"{{#label}}" still contains an unedited placeholder value (e.g. copied from .env.example without being replaced) — set a real value',
  'secret.weak':
    '"{{#label}}" is a well-known weak/example value and cannot be used in production — set a real secret',
  'string.min':
    '"{{#label}}" must be at least {{#limit}} characters long in production',
};

/**
 * A cryptographic secret (JWT signing key, encryption key, payment provider secret, cache auth
 * token). Placeholder-checked in every environment; required, minimum-length-checked, and
 * known-weak-value-checked only in production — mirrors this file's pre-existing "production-
 * safe, development-friendly" posture, just extended to secrets that previously had no
 * validation here at all (Razorpay, the bank-account encryption key, Redis auth token).
 */
function productionSecret(minLength: number) {
  return Joi.string()
    .custom(rejectPlaceholder)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(minLength).required().custom(rejectKnownWeakValue),
      otherwise: Joi.string().optional().allow(''),
    })
    .messages(PLACEHOLDER_MESSAGES);
}

/** A frontend/API origin URL — must be a well-formed http(s) URL whenever it's set, and required
 *  (not merely well-formed-if-present) in production, since CORS silently rejects every browser
 *  request without it (main.ts's buildCorsOriginValidator fails closed, which is safe but leaves
 *  the API unusable from any browser — not what "safe production configuration" should mean). */
function productionUrl() {
  return Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .required(),
      otherwise: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .optional()
        .allow(''),
    });
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production')
    .required(),

  PORT: Joi.number().port().required(),

  DATABASE_URL: Joi.string().uri().required(),

  REDIS_HOST: Joi.string().required(),

  REDIS_PORT: Joi.number().port().required(),

  // Absent in local development (docker-compose's plain Redis has no TLS/AUTH) — required in
  // production because ElastiCache/Upstash reject a plain, unauthenticated connection outright
  // (see redis-connection.config.ts's doc comment), so a missing value there wouldn't "degrade
  // gracefully," it would just fail every Redis operation with no clear signal at boot time.
  REDIS_TLS: Joi.boolean().truthy('true').falsy('false').when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  REDIS_AUTH_TOKEN: productionSecret(8),

  JWT_ACCESS_SECRET: Joi.string()
    .required()
    .custom(rejectPlaceholder)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(32).custom(rejectKnownWeakValue),
    })
    .messages(PLACEHOLDER_MESSAGES),

  // Must differ from JWT_ACCESS_SECRET in every environment, not just production — two identical
  // signing keys mean a refresh token would also verify as a valid access token (and vice versa),
  // which is never an intentional configuration.
  JWT_REFRESH_SECRET: Joi.string()
    .required()
    .custom(rejectPlaceholder)
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(32).custom(rejectKnownWeakValue),
    })
    .messages({
      ...PLACEHOLDER_MESSAGES,
      'any.invalid':
        '"JWT_REFRESH_SECRET" must be different from JWT_ACCESS_SECRET',
    }),

  // No Kafka client exists anywhere in this codebase — kept required so an unrelated future
  // consumer can't silently start against an unconfigured broker, but this is otherwise dead
  // configuration (render.yaml sets a placeholder value purely to satisfy this).
  KAFKA_BROKER: Joi.string().required(),

  STORAGE_DRIVER: Joi.string().valid('local', 'cloudinary').optional(),

  // Required only when STORAGE_DRIVER=cloudinary — enforced at CloudinaryStorageProvider
  // construction time rather than here (deliberately preserved from before this sprint: it's
  // already a well-behaved deferred check, always via ConfigService, always a clear named error —
  // see CloudinaryStorageProvider.requireConfig()), so local/QA-with-local-storage environments
  // are never blocked by these.
  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),
  CLOUDINARY_API_KEY: Joi.string().optional(),
  CLOUDINARY_API_SECRET: Joi.string().optional(),

  // Sprint 1.6 — required in production. Unlike SMTP/Cloudinary below, a missing key here isn't
  // "a feature doesn't work until first used" — it's "restaurant bank account data becomes
  // unencryptable/undecryptable," a data-integrity failure mode severe enough (and explicitly
  // called out by name in this sprint's brief) to warrant failing fast at boot rather than at
  // first use.
  BANK_ACCOUNT_ENCRYPTION_KEY: productionSecret(20),

  // Required only once a password-reset email is actually sent — enforced at that call site
  // (EmailService.requireConfig()), not at boot, so environments that never trigger a reset
  // aren't blocked. Deliberately preserved as-is: this is already a well-behaved deferred check
  // (always via ConfigService, always a clear named error), and — unlike the bank-account key —
  // a missing value here fails safely (an observable, retryable "email didn't send," not silent
  // data loss), so promoting it to a hard boot-time requirement isn't warranted.
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional(),

  // CORS allowlist (LH1-09) — required in production: main.ts's buildCorsOriginValidator fails
  // closed (safe) without these, but that means every credentialed browser request is rejected,
  // i.e. the deployed API is unusable from any of its own frontends. Optional outside production
  // so local development (which allows localhost regardless) isn't blocked.
  CUSTOMER_APP_URL: productionUrl(),
  RESTAURANT_APP_URL: productionUrl(),
  ADMIN_APP_URL: productionUrl(),
  DELIVERY_APP_URL: productionUrl(),

  // This API's own public origin (Swagger UI self-origin allowlisting) and an optional,
  // comma-separated list of further origins — both optional in every environment (the four
  // *_APP_URL vars above are what actually gate real user traffic), both feed the same CORS
  // allowlist (main.ts's buildCorsOriginValidator).
  API_PUBLIC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  EXTRA_ALLOWED_ORIGINS: Joi.string().optional().allow(''),

  // Payments (Razorpay) — Sprint 1.5 found these were read with `!` non-null assertions and no
  // validation anywhere; the failure mode was a raw, unhelpful TypeError deep inside the first
  // real payment/webhook request. Required in production; RAZORPAY_KEY_ID is additionally
  // required to actually be a live key there, not a test key left over from copying a QA/staging
  // config — the single most common "wrong environment value" mistake for a payments integration.
  RAZORPAY_KEY_ID: Joi.string()
    .custom(rejectPlaceholder)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .pattern(/^rzp_live_/)
        .required()
        .messages({
          'string.pattern.base':
            '"RAZORPAY_KEY_ID" must be a live key (rzp_live_...) in production, not a test key (rzp_test_...)',
        }),
      otherwise: Joi.string().optional().allow(''),
    })
    .messages(PLACEHOLDER_MESSAGES),
  RAZORPAY_KEY_SECRET: productionSecret(20),
  RAZORPAY_WEBHOOK_SECRET: productionSecret(20),

  // Super Admin bootstrap (AdminBootstrapService) — deliberately `.optional()` here even though
  // the bootstrap process treats all five as mandatory for itself: making these Joi-`.required()`
  // would crash the entire application at ConfigModule validation time in any environment that
  // hasn't set them yet, which is exactly the crash bootstrap itself is required never to cause.
  // AdminBootstrapService performs its own presence check and skips bootstrap (logged, not
  // thrown) when any of these are missing. Still placeholder-checked, in every environment, since
  // an unedited "replace-with-a-long-random-value" super-admin password would otherwise silently
  // become the actual login credential.
  SUPER_ADMIN_EMAIL: Joi.string()
    .custom(rejectPlaceholder)
    .optional()
    .messages(PLACEHOLDER_MESSAGES),
  SUPER_ADMIN_PASSWORD: Joi.string()
    .custom(rejectPlaceholder)
    .optional()
    .messages(PLACEHOLDER_MESSAGES),
  SUPER_ADMIN_FIRST_NAME: Joi.string().optional(),
  SUPER_ADMIN_LAST_NAME: Joi.string().optional(),
  SUPER_ADMIN_PHONE: Joi.string().optional(),

  // Operational (never secret) — validated for type/shape but never required.
  LOG_TO_FILE: Joi.boolean().truthy('true').falsy('false').optional(),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .optional(),
  SHUTDOWN_TIMEOUT_MS: Joi.number().integer().positive().optional(),
  APP_NAME: Joi.string().optional(),
}).unknown(true);
