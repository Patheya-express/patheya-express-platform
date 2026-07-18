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

/** Any localhost/127.0.0.1 origin, regardless of port — dev servers (`ng serve`) don't have a
 *  fixed port across the four apps, and this is local-machine-only convenience, not a security
 *  boundary. Never matches in production (NODE_ENV check happens at the call site). */
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Builds the CORS allowlist from the four deployed frontend origins (env-driven, same
 * `frontendOrigins` config the password-reset email link uses) plus, outside production, any
 * localhost origin. Replaces the previous `origin: true` (reflects any origin) which is unsafe
 * for a credentialed API.
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
  ].filter((origin): origin is string => Boolean(origin));

  const isProduction = config.get<string>('app.nodeEnv') === 'production';

  return (origin, callback) => {
    // No Origin header (server-to-server calls, curl, health checks) — always allow.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
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

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.log({ event: 'shutdown_signal_received', signal }, 'Bootstrap');

      // Safety net: if a lifecycle hook hangs, force-exit within the orchestrator's grace
      // period rather than waiting for a SIGKILL. unref()'d so a clean shutdown that finishes
      // first isn't held open by this timer.
      setTimeout(() => {
        logger.error(
          { event: 'shutdown_timeout', signal, shutdownTimeoutMs },
          undefined,
          'Bootstrap',
        );

        process.exit(1);
      }, shutdownTimeoutMs).unref();
    });
  }

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
