import { ValidationPipe } from '@nestjs/common';

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

  app.enableCors({
    origin: true,

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
  const config = new DocumentBuilder()
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

  const document = SwaggerModule.createDocument(app, config);

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
