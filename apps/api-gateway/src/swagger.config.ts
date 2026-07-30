import { INestApplication } from '@nestjs/common';

import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Shared by main.ts (live `/api/docs*`) and scripts/export-openapi.ts (static CI artifact) so the
 * two can never drift apart — platform-standards.md Section 15/21 requires the OpenAPI document
 * to be the single source of truth the frontend `api-sdk` is generated from.
 */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
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

  return SwaggerModule.createDocument(app, swaggerConfig);
}
