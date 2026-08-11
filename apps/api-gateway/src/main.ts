import { RequestMethod, ValidationPipe } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { NestFactory } from '@nestjs/core';

import { NestExpressApplication } from '@nestjs/platform-express';

import { join } from 'path';

import helmet from 'helmet';

import compression from 'compression';

import { AppModule } from './app.module';

import { GlobalExceptionFilter } from './core/filters/global-exception.filter';

import { ResponseInterceptor } from './core/interceptors/response.interceptor';

import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

import { AppLoggerService } from './infrastructure/logger/logger.service';

import { MetricsService } from './modules/metrics/metrics.service';

import { SwaggerModule } from '@nestjs/swagger';

import { buildSwaggerDocument } from './swagger.config';

import { registerProcessLifecycleHandlers } from './bootstrap/process-lifecycle';

/** Any localhost/127.0.0.1 origin, regardless of port — dev servers (`ng serve`) don't have a
 *  fixed port across the four apps, and this is local-machine-only convenience, not a security
 *  boundary. Never matches in production (NODE_ENV check happens at the call site). */
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Strips a trailing slash so a config value like `https://api.example.com/` still matches the
 *  browser's `Origin` header, which never has one (e.g. `https://api.example.com`). Applied to
 *  every allowlist entry below — a trailing slash is an easy, otherwise-silent misconfiguration. */
function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/**
 * Builds the CORS allowlist from:
 *  - the four deployed frontend origins (env-driven, same `frontendOrigins` config the
 *    password-reset email link uses),
 *  - this API's own public origin (`cors.apiPublicUrl`), so Swagger UI — served by this same
 *    process at `/api/docs` — can call `/api/v1/*` without being rejected. Browsers attach an
 *    `Origin` header to same-origin XHR/fetch requests too (notably Swagger UI's "Try it out"),
 *    and this CORS middleware evaluates every request that carries one, regardless of whether the
 *    browser itself would also enforce cross-origin restrictions on it,
 *  - any further origins listed in `cors.extraAllowedOrigins` (optional, comma-separated, for
 *    future expansion without a code change),
 *  - plus, outside production, any localhost origin.
 *
 * Replaces the previous `origin: true` (reflects any origin), which is unsafe for a credentialed
 * API — every branch below is still an explicit allowlist match; nothing here reintroduces a
 * wildcard or weakens the credentialed-CORS posture.
 */
function buildCorsOriginValidator(
  config: ConfigService,
): (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void {
  const allowedOrigins = [
    config.get<string>('frontendOrigins.customerApp'),
    config.get<string>('frontendOrigins.restaurantApp'),
    config.get<string>('frontendOrigins.adminApp'),
    config.get<string>('frontendOrigins.deliveryApp'),
    config.get<string>('cors.apiPublicUrl'),
    ...config.get<string[]>('cors.extraAllowedOrigins', []),
  ]
    .filter((origin): origin is string => Boolean(origin))
    .map(normalizeOrigin);

  const isProduction = config.get<string>('app.nodeEnv') === 'production';

  return (origin, callback) => {
    // No Origin header (server-to-server calls, curl, health checks) — always allow.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }

    if (!isProduction && LOCALHOST_ORIGIN_PATTERN.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin "${origin}" is not allowed by CORS`), false);
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Behind a K8s Ingress/load balancer, every request otherwise arrives from the proxy's IP —
  // this makes `req.ip` (and therefore per-client rate limiting) reflect the real client instead.
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'metrics', method: RequestMethod.GET }],
  });

  // Serves files written by LocalStorageProvider (e.g. restaurant logos/banners) at the same
  // `/uploads/...` path it returns as the stored URL — outside the `api/v1` prefix, since it's
  // static file serving via Express middleware, not a routed controller.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  app.use(helmet());

  app.use(compression());

  const config = app.get(ConfigService);

  app.enableCors({
    origin: buildCorsOriginValidator(config),

    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,

      forbidNonWhitelisted: true,

      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());

  const logger = app.get(AppLoggerService);

  app.useGlobalFilters(new GlobalExceptionFilter(logger));

  app.useGlobalInterceptors(
    new LoggingInterceptor(logger, app.get(MetricsService)),
  );

  // Wires Nest's own onModuleDestroy/onApplicationShutdown lifecycle (Prisma.$disconnect(),
  // Redis.quit(), etc.) to SIGTERM/SIGINT — without this, those hooks only ever ran when Nest
  // shut itself down programmatically, never on a real container stop signal.
  app.enableShutdownHooks();

  const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;

  // Phase 0 remediation: SIGTERM/SIGINT (as before) plus unhandledRejection/uncaughtException
  // (previously unhandled — see process-lifecycle.ts for the full rationale and shutdown
  // sequence).
  registerProcessLifecycleHandlers({
    app,
    logger,
    context: 'Bootstrap',
    shutdownTimeoutMs,
  });

  const document = buildSwaggerDocument(app);

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
  });

  await app.listen(process.env.PORT || 3000);
}

void bootstrap();
