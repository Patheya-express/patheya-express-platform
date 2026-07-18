import { mkdirSync, writeFileSync } from 'fs';

import { dirname, join } from 'path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';

import { buildSwaggerDocument } from '../src/swagger.config';

/**
 * Boots the full Nest DI graph (same providers main.ts constructs) but never calls `.listen()` —
 * writes a static openapi.json instead. platform-standards.md Section 15/21: the frontend
 * `api-sdk` is generated from this document, "regenerated in CI," never hand-maintained.
 *
 * Needs the same DB/Redis reachability the app's providers require at construction time —
 * .github/workflows/backend-ci.yml provisions ephemeral Postgres/Redis service containers for
 * this step, same as it does for the test job.
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  app.setGlobalPrefix('api/v1');

  const document = buildSwaggerDocument(app);

  const outPath = join(process.cwd(), 'openapi.json');

  mkdirSync(dirname(outPath), { recursive: true });

  writeFileSync(outPath, JSON.stringify(document, null, 2));

  console.log(`OpenAPI document written to ${outPath}`);

  await app.close();
}

main().catch((error: unknown) => {
  console.error('Failed to export OpenAPI document:', error);

  process.exitCode = 1;
});
