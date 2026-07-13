import { ValidationPipe } from '@nestjs/common';

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

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

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

  app.setGlobalPrefix('api/v1');

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

  app.useGlobalInterceptors(new LoggingInterceptor(logger));
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Patheya Express API')
    .setDescription('Enterprise Backend APIs')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
  });

  await app.listen(process.env.PORT || 3000);
}

bootstrap();
