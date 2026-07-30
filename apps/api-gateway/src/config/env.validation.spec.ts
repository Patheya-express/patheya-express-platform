import { envValidationSchema } from './env.validation';

/**
 * Sprint 1.6 — production configuration & secrets hardening. Every scenario the sprint brief
 * explicitly asked for (Phase 8): missing JWT/refresh/DB/Redis/encryption-key/Razorpay secrets,
 * placeholder secrets, invalid URL/CORS/numeric/boolean/environment values, and that a genuinely
 * complete production config passes while development stays permissive for everything not
 * explicitly listed in the sprint brief as a hard requirement.
 */
describe('envValidationSchema', () => {
  const VALID_DEVELOPMENT_ENV = {
    NODE_ENV: 'development',
    PORT: 3000,
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/patheya_dev',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    JWT_ACCESS_SECRET: 'dev-access-secret',
    JWT_REFRESH_SECRET: 'dev-refresh-secret',
    KAFKA_BROKER: 'localhost:9092',
  };

  const VALID_PRODUCTION_ENV = {
    NODE_ENV: 'production',
    PORT: 3000,
    DATABASE_URL:
      'postgresql://patheya:S0m3R3alP4ssw0rd@prod-db.internal:5432/patheya_prod',
    REDIS_HOST: 'prod-redis.internal',
    REDIS_PORT: 6379,
    REDIS_TLS: 'true',
    REDIS_AUTH_TOKEN: 'a-real-upstash-password-123',
    JWT_ACCESS_SECRET: 'K7f3n2Qz9mP1xR8sT4vW6yB0cD5gH2jL9nQ3sV7x',
    JWT_REFRESH_SECRET: 'M8g4o3Ra0nQ2yS9tU5wX7zC1dE6hI3kM0oR4tW8y',
    KAFKA_BROKER: 'localhost:9092',
    BANK_ACCOUNT_ENCRYPTION_KEY:
      'a-real-32-plus-character-encryption-key-value',
    CUSTOMER_APP_URL: 'https://app.patheyaexpress.com',
    RESTAURANT_APP_URL: 'https://partner.patheyaexpress.com',
    ADMIN_APP_URL: 'https://admin.patheyaexpress.com',
    DELIVERY_APP_URL: 'https://delivery.patheyaexpress.com',
    RAZORPAY_KEY_ID: 'rzp_live_ABC123real456',
    RAZORPAY_KEY_SECRET: 'a-real-razorpay-key-secret-value',
    RAZORPAY_WEBHOOK_SECRET: 'a-real-razorpay-webhook-secret-value',
  };

  function validate(env: Record<string, unknown>) {
    return envValidationSchema.validate(env, { abortEarly: false });
  }

  describe('happy paths', () => {
    it('a minimal, valid development config passes', () => {
      const { error } = validate(VALID_DEVELOPMENT_ENV);
      expect(error).toBeUndefined();
    });

    it('a complete, valid production config passes', () => {
      const { error } = validate(VALID_PRODUCTION_ENV);
      expect(error).toBeUndefined();
    });

    it('unrelated OS-level environment variables (PATH, HOME, ...) do not fail validation', () => {
      const { error } = validate({
        ...VALID_DEVELOPMENT_ENV,
        PATH: '/usr/bin',
        HOME: '/root',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('missing required secrets', () => {
    it('missing JWT_ACCESS_SECRET fails, in any environment', () => {
      const env = { ...VALID_DEVELOPMENT_ENV } as Record<string, unknown>;
      delete env['JWT_ACCESS_SECRET'];
      const { error } = validate(env);
      expect(error?.message).toMatch(/JWT_ACCESS_SECRET/);
    });

    it('missing JWT_REFRESH_SECRET fails, in any environment', () => {
      const env = { ...VALID_DEVELOPMENT_ENV } as Record<string, unknown>;
      delete env['JWT_REFRESH_SECRET'];
      const { error } = validate(env);
      expect(error?.message).toMatch(/JWT_REFRESH_SECRET/);
    });

    it('missing DATABASE_URL fails', () => {
      const env = { ...VALID_DEVELOPMENT_ENV } as Record<string, unknown>;
      delete env['DATABASE_URL'];
      const { error } = validate(env);
      expect(error?.message).toMatch(/DATABASE_URL/);
    });

    it('missing REDIS_HOST fails', () => {
      const env = { ...VALID_DEVELOPMENT_ENV } as Record<string, unknown>;
      delete env['REDIS_HOST'];
      const { error } = validate(env);
      expect(error?.message).toMatch(/REDIS_HOST/);
    });

    it('missing BANK_ACCOUNT_ENCRYPTION_KEY fails in production but not in development', () => {
      const prodEnv = { ...VALID_PRODUCTION_ENV } as Record<string, unknown>;
      delete prodEnv['BANK_ACCOUNT_ENCRYPTION_KEY'];
      expect(validate(prodEnv).error?.message).toMatch(
        /BANK_ACCOUNT_ENCRYPTION_KEY/,
      );

      expect(validate(VALID_DEVELOPMENT_ENV).error).toBeUndefined();
    });

    it('missing RAZORPAY_KEY_SECRET fails in production but not in development', () => {
      const prodEnv = { ...VALID_PRODUCTION_ENV } as Record<string, unknown>;
      delete prodEnv['RAZORPAY_KEY_SECRET'];
      expect(validate(prodEnv).error?.message).toMatch(/RAZORPAY_KEY_SECRET/);

      expect(validate(VALID_DEVELOPMENT_ENV).error).toBeUndefined();
    });

    it('missing RAZORPAY_WEBHOOK_SECRET fails in production but not in development', () => {
      const prodEnv = { ...VALID_PRODUCTION_ENV } as Record<string, unknown>;
      delete prodEnv['RAZORPAY_WEBHOOK_SECRET'];
      expect(validate(prodEnv).error?.message).toMatch(
        /RAZORPAY_WEBHOOK_SECRET/,
      );
    });

    it('missing REDIS_TLS fails in production but not in development', () => {
      const prodEnv = { ...VALID_PRODUCTION_ENV } as Record<string, unknown>;
      delete prodEnv['REDIS_TLS'];
      expect(validate(prodEnv).error?.message).toMatch(/REDIS_TLS/);
    });

    it('missing REDIS_AUTH_TOKEN fails in production but not in development', () => {
      const prodEnv = { ...VALID_PRODUCTION_ENV } as Record<string, unknown>;
      delete prodEnv['REDIS_AUTH_TOKEN'];
      expect(validate(prodEnv).error?.message).toMatch(/REDIS_AUTH_TOKEN/);
    });

    it('missing a frontend CORS origin URL fails in production but not in development', () => {
      const prodEnv = { ...VALID_PRODUCTION_ENV } as Record<string, unknown>;
      delete prodEnv['CUSTOMER_APP_URL'];
      expect(validate(prodEnv).error?.message).toMatch(/CUSTOMER_APP_URL/);

      expect(validate(VALID_DEVELOPMENT_ENV).error).toBeUndefined();
    });
  });

  describe('placeholder secret detection', () => {
    it('rejects the literal placeholder text .env.example ships, even in development', () => {
      const env = {
        ...VALID_DEVELOPMENT_ENV,
        JWT_ACCESS_SECRET: 'replace-with-a-long-random-value',
      };
      const { error } = validate(env);
      expect(error?.message).toMatch(/placeholder/i);
    });

    it('rejects a "changeme"-style placeholder in the bank-account encryption key', () => {
      const env = {
        ...VALID_PRODUCTION_ENV,
        BANK_ACCOUNT_ENCRYPTION_KEY: 'CHANGEME-please-set-a-real-key',
      };
      const { error } = validate(env);
      expect(error?.message).toMatch(/placeholder/i);
    });

    it('rejects an unedited Super Admin password placeholder even though the field itself is optional', () => {
      const env = {
        ...VALID_DEVELOPMENT_ENV,
        SUPER_ADMIN_PASSWORD: 'replace-with-a-long-random-value',
      };
      const { error } = validate(env);
      expect(error?.message).toMatch(/SUPER_ADMIN_PASSWORD/);
    });
  });

  describe('weak/short secret detection (production only)', () => {
    it('rejects a well-known weak value ("secret") for JWT_ACCESS_SECRET in production', () => {
      const env = { ...VALID_PRODUCTION_ENV, JWT_ACCESS_SECRET: 'secret' };
      const { error } = validate(env);
      expect(error?.message).toMatch(/JWT_ACCESS_SECRET/);
    });

    it('allows the same short dev-convenience secret in development', () => {
      const { error } = validate(VALID_DEVELOPMENT_ENV);
      expect(error).toBeUndefined();
    });

    it('rejects a JWT_ACCESS_SECRET shorter than 32 characters in production', () => {
      const env = {
        ...VALID_PRODUCTION_ENV,
        JWT_ACCESS_SECRET: 'tooShortForProd123',
      };
      const { error } = validate(env);
      expect(error?.message).toMatch(/JWT_ACCESS_SECRET/);
    });

    it('rejects JWT_ACCESS_SECRET and JWT_REFRESH_SECRET being identical, in any environment', () => {
      const devEnv = {
        ...VALID_DEVELOPMENT_ENV,
        JWT_REFRESH_SECRET: VALID_DEVELOPMENT_ENV.JWT_ACCESS_SECRET,
      };
      expect(validate(devEnv).error?.message).toMatch(/JWT_REFRESH_SECRET/);

      const prodEnv = {
        ...VALID_PRODUCTION_ENV,
        JWT_REFRESH_SECRET: VALID_PRODUCTION_ENV.JWT_ACCESS_SECRET,
      };
      expect(validate(prodEnv).error?.message).toMatch(/JWT_REFRESH_SECRET/);
    });
  });

  describe('wrong-environment-value detection', () => {
    it('rejects a test Razorpay key (rzp_test_) in production', () => {
      const env = {
        ...VALID_PRODUCTION_ENV,
        RAZORPAY_KEY_ID: 'rzp_test_leftoverFromQA123',
      };
      const { error } = validate(env);
      expect(error?.message).toMatch(/live key/);
    });

    it('accepts a live Razorpay key (rzp_live_) in production', () => {
      const { error } = validate(VALID_PRODUCTION_ENV);
      expect(error).toBeUndefined();
    });

    it('does not require any particular Razorpay key prefix outside production', () => {
      const env = {
        ...VALID_DEVELOPMENT_ENV,
        RAZORPAY_KEY_ID: 'rzp_test_anything',
      };
      expect(validate(env).error).toBeUndefined();
    });
  });

  describe('invalid primitive types', () => {
    it('rejects an unsupported NODE_ENV value', () => {
      const env = { ...VALID_DEVELOPMENT_ENV, NODE_ENV: 'prod' };
      const { error } = validate(env);
      expect(error?.message).toMatch(/NODE_ENV/);
    });

    it('rejects a non-numeric PORT', () => {
      const env = { ...VALID_DEVELOPMENT_ENV, PORT: 'not-a-number' };
      const { error } = validate(env);
      expect(error?.message).toMatch(/PORT/);
    });

    it('rejects a PORT outside the valid port range', () => {
      const env = { ...VALID_DEVELOPMENT_ENV, PORT: 999999 };
      const { error } = validate(env);
      expect(error?.message).toMatch(/PORT/);
    });

    it('rejects an invalid CUSTOMER_APP_URL (not a URL)', () => {
      const env = { ...VALID_PRODUCTION_ENV, CUSTOMER_APP_URL: 'not-a-url' };
      const { error } = validate(env);
      expect(error?.message).toMatch(/CUSTOMER_APP_URL/);
    });

    it('rejects a malformed REDIS_TLS boolean ("yes" instead of "true"/"false")', () => {
      const env = { ...VALID_PRODUCTION_ENV, REDIS_TLS: 'yes' };
      const { error } = validate(env);
      expect(error?.message).toMatch(/REDIS_TLS/);
    });

    it('rejects an invalid LOG_LEVEL enum value', () => {
      const env = { ...VALID_DEVELOPMENT_ENV, LOG_LEVEL: 'shout' };
      const { error } = validate(env);
      expect(error?.message).toMatch(/LOG_LEVEL/);
    });

    it('rejects a malformed DATABASE_URL', () => {
      const env = {
        ...VALID_DEVELOPMENT_ENV,
        DATABASE_URL: 'not a url at all',
      };
      const { error } = validate(env);
      expect(error?.message).toMatch(/DATABASE_URL/);
    });
  });
});
