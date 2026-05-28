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

  await app.listen(
    process.env.PORT || 3000,
  );

}

bootstrap();