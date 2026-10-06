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
    // Relative, not an absolute environment URL — this document is shared verbatim across every
    // environment (dev/QA/staging/production all mount the same app at the same relative path;
    // see this function's own doc comment on why the export must stay identical everywhere), and
    // every path below already includes the real `api/v1` global prefix (main.ts's
    // `setGlobalPrefix`), so `/` is "relative to wherever this document itself is being served
    // from," not a second, competing prefix. Satisfies Redocly's `no-empty-servers` rule without
    // asserting a specific host this document doesn't actually know.
    .addServer('/')
    .addBearerAuth(
      {
        // `in` is only a valid field on an `apiKey`-type security scheme, not `http`/`bearer` —
        // an HTTP bearer scheme's location is implicitly always the Authorization header per the
        // OpenAPI 3.x spec, so this field is invalid here (Redocly's `security/in` check on
        // #/components/securitySchemes flags it as a schema error, not a style preference).
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  markUndocumentedOperationsAsPublic(document);

  return document;
}

/**
 * Redocly's `security-defined` rule requires every operation to have an explicit `security` array
 * (or a document-level default) — omitting it is spec-valid (it means "no security requirement"),
 * but ambiguous enough that Redocly's recommended ruleset flags it. Every endpoint that actually
 * requires a JWT already gets a `security` entry from its own `@ApiBearerAuth('JWT-auth')`
 * decorator (a real, separately-enforced `@UseGuards(JwtAuthGuard)` decision, not documentation
 * guesswork); this only fills in `security: []` for whatever's left, i.e. mechanically documents
 * "this endpoint has no security requirement" for exactly the endpoints already true of — it can
 * never contradict an endpoint's actual guard, since it never touches an operation that already
 * has a `security` array.
 */
function markUndocumentedOperationsAsPublic(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const key of Object.keys(pathItem)) {
      const operation = (pathItem as Record<string, unknown>)[key];

      if (
        typeof operation === 'object' &&
        operation !== null &&
        'operationId' in operation &&
        !('security' in operation)
      ) {
        (operation as Record<string, unknown>).security = [];
      }
    }
  }
}
