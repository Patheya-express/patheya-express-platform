import { RequestMethod, ValidationPipe } from '@nestjs/common';

import { NestFactory } from '@nestjs/core';

import { NestExpressApplication } from '@nestjs/platform-express';

import { WorkerModule } from './worker.module';

import { GlobalExceptionFilter } from './core/filters/global-exception.filter';

import { ResponseInterceptor } from './core/interceptors/response.interceptor';

import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

import { AppLoggerService } from './infrastructure/logger/logger.service';

import { MetricsService } from './modules/metrics/metrics.service';

import { registerProcessLifecycleHandlers } from './bootstrap/process-lifecycle';

/**
 * The standalone worker entrypoint (Section 1: "Worker Service (worker-main.ts)") —
 * `k8s/base/workers/deployment.yaml` runs this file, not `main.ts`, closing the gap
 * `docs/infrastructure/workers.md` documented ("the identical full-app image/command as
 * api-gateway... splitting that out is an application-code change, out of scope").
 *
 * Still boots a real (small) HTTP server — not `NestFactory.createApplicationContext()` — because
 * Kubernetes' liveness/readiness probes need an actual endpoint to hit, and reusing the exact same
 * `HealthController`/`HealthService` pair api-gateway already uses (rather than inventing a second,
 * divergent health-check mechanism) is worth the one small HTTP listener it requires. No Swagger,
 * no helmet/compression/CORS, no static asset serving — none of those serve any purpose for a
 * process with no business controllers and no browser clients.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(WorkerModule, {
    rawBody: true,
  });

  app.set('trust proxy', 1);

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'metrics', method: RequestMethod.GET }],
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

  // Same graceful-shutdown contract as main.ts — BullMQ's own Worker instances (created
  // internally by @nestjs/bullmq's @Processor decorator) stop pulling new jobs and let
  // in-flight jobs finish within this same terminationGracePeriodSeconds window.
  app.enableShutdownHooks();

  const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;

  // Phase 0 remediation: SIGTERM/SIGINT (as before) plus unhandledRejection/uncaughtException
  // (previously unhandled — see process-lifecycle.ts for the full rationale and shutdown
  // sequence).
  registerProcessLifecycleHandlers({
    app,
    logger,
    context: 'WorkerBootstrap',
    shutdownTimeoutMs,
  });

  await app.listen(process.env.PORT || 3000);

  logger.log({ event: 'worker_started' }, 'WorkerBootstrap');
}

void bootstrap();
