export default () => ({
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV,
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },

  kafka: {
    broker: process.env.KAFKA_BROKER,
  },
  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',

    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      /** Optional — set for S3-compatible providers (e.g. R2, MinIO, DigitalOcean Spaces). */
      endpoint: process.env.S3_ENDPOINT,
      /** Optional CDN/base URL to serve uploaded files from instead of the raw bucket URL. */
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    },
  },

  security: {
    /** AES-256-GCM key (32-byte, base64) for encrypting restaurant bank account numbers at
     *  rest. No production default — RestaurantBankAccountRepository throws clearly if this is
     *  missing when an encrypt/decrypt is actually attempted, rather than failing silently. */
    bankAccountEncryptionKey: process.env.BANK_ACCOUNT_ENCRYPTION_KEY,
  },

  email: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from:
        process.env.SMTP_FROM ||
        'Patheya Express <no-reply@patheyaexpress.com>',
    },
  },

  /** Deployed origin of each frontend app — the CORS allowlist (main.ts) and the link embedded
   *  in the password-reset email both read from this. */
  frontendOrigins: {
    customerApp: process.env.CUSTOMER_APP_URL,
    restaurantApp: process.env.RESTAURANT_APP_URL,
    adminApp: process.env.ADMIN_APP_URL,
    deliveryApp: process.env.DELIVERY_APP_URL,
  },
});
