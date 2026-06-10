import {
  ValidationPipe,
} from '@nestjs/common';

import { NestFactory }
from '@nestjs/core';

import helmet from 'helmet';

import compression
from 'compression';

import { AppModule }
from './app.module';

import {
  GlobalExceptionFilter,
} from './core/filters/global-exception.filter';

import {
  ResponseInterceptor,
} from './core/interceptors/response.interceptor';

import {
  LoggingInterceptor,
} from './common/interceptors/logging.interceptor';

import {
  AppLoggerService,
} from './infrastructure/logger/logger.service';

import {
  SwaggerModule,
  DocumentBuilder,
} from '@nestjs/swagger';

async function bootstrap() {

  const app =
    await NestFactory
      .create(AppModule);

  app.setGlobalPrefix(
    'api/v1',
  );

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

  app.useGlobalFilters(
    new GlobalExceptionFilter(),
  );

  app.useGlobalInterceptors(
    new ResponseInterceptor(),
  );

  const logger =
  app.get(
    AppLoggerService,
  );

app.useGlobalInterceptors(

  new LoggingInterceptor(
    logger,
  ),

);
const config =

  new DocumentBuilder()

    .setTitle(
      'Patheya Express API',
    )

    .setDescription(
      'Enterprise Backend APIs',
    )

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

const document =

  SwaggerModule.createDocument(
    app,
    config,
  );

  SwaggerModule.setup(
    'api/docs',
    app,
    document,
    {
      swaggerOptions: {
        persistAuthorization: true,
      },
    },
  );

  await app.listen(
    process.env.PORT || 3000,
  );

}

bootstrap();