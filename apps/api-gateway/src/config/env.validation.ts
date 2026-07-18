import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production')
    .required(),

  PORT: Joi.number().required(),

  DATABASE_URL: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),

  REDIS_PORT: Joi.number().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),

  JWT_REFRESH_SECRET: Joi.string().required(),

  KAFKA_BROKER: Joi.string().required(),

  STORAGE_DRIVER: Joi.string().valid('local', 'cloudinary').optional(),

  // Required only when STORAGE_DRIVER=cloudinary — enforced at CloudinaryStorageProvider
  // construction time rather than here, so local-driver dev/test environments are never
  // blocked by these.
  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),
  CLOUDINARY_API_KEY: Joi.string().optional(),
  CLOUDINARY_API_SECRET: Joi.string().optional(),

  // Required only once a restaurant bank account is actually created/decrypted — enforced at
  // that call site so environments that never touch banking data aren't blocked by it.
  BANK_ACCOUNT_ENCRYPTION_KEY: Joi.string().optional(),

  // Required only once a password-reset email is actually sent — enforced at that call site
  // (EmailService), not at boot, so environments that never trigger a reset aren't blocked.
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional(),

  // CORS allowlist (LH1-09) — optional so local development (which allows localhost regardless)
  // isn't blocked; required in practice for a production deployment to accept browser requests.
  CUSTOMER_APP_URL: Joi.string().optional(),
  RESTAURANT_APP_URL: Joi.string().optional(),
  ADMIN_APP_URL: Joi.string().optional(),
  DELIVERY_APP_URL: Joi.string().optional(),

  // This API's own public origin (Swagger UI self-origin allowlisting) and an optional,
  // comma-separated list of further origins — both optional, both feed the same CORS allowlist
  // as the four *_APP_URL vars above (main.ts's buildCorsOriginValidator).
  API_PUBLIC_URL: Joi.string().optional(),
  EXTRA_ALLOWED_ORIGINS: Joi.string().optional(),
});
