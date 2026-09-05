import { INestApplication } from '@nestjs/common';

import { AppLoggerService } from '../infrastructure/logger/logger.service';

import { markRedisShuttingDown } from '../infrastructure/redis/redis-retry-policy';

export interface RegisterProcessLifecycleHandlersOptions {
  app: INestApplication;
  logger: AppLoggerService;
  /** Log `context` value — matches the existing 'Bootstrap'/'WorkerBootstrap' convention. */
  context: string;
  shutdownTimeoutMs: number;
}

/**
 * Phase 0 remediation — process-level shutdown orchestration shared by `main.ts` and
 * `worker-main.ts`.
 *
 * Consolidates what was previously duplicated inline in each entrypoint (SIGTERM/SIGINT logging +
 * a bounded fallback force-exit timer) and adds the two handlers the Phase 0 audit found missing:
 * `unhandledRejection`/`uncaughtException`. Before this, an unhandled rejection (e.g. from
 * `@socket.io/redis-adapter`'s unawaited `.publish()` calls during a Redis error) fell through to
 * Node's default behavior — an abrupt crash with no structured log and no chance for Redis/BullMQ/
 * Socket.IO to close cleanly. This gives every fatal process-level error the same controlled path
 * SIGTERM already had:
 *
 *   fatal error (signal or unhandled rejection/exception)
 *           v
 *   structured log (once — a shared `shuttingDown` flag prevents a second trigger from logging or
 *                    scheduling a second shutdown if e.g. an uncaughtException fires while an
 *                    unhandledRejection-triggered shutdown is already in flight)
 *           v
 *   mark Redis "shutting down" (redis-retry-policy.ts) — stops any in-flight reconnect backoff
 *   from scheduling another attempt, before Nest's own lifecycle hooks even start
 *           v
 *   Nest lifecycle hooks run — for a signal, via Nest's own listener registered by
 *   `app.enableShutdownHooks()`; for a fatal error, by this code explicitly calling `app.close()`
 *   (there is no OS signal to trigger Nest's own listener in that case)
 *           v
 *   Redis / Socket.IO / BullMQ cleanup (RedisService, RedisLifecycleService's Socket.IO shutdown,
 *   @nestjs/bullmq's own worker.close() drain, Prisma) all run inside that lifecycle
 *           v
 *   bounded fallback timer (`shutdownTimeoutMs`, `.unref()`'d) force-exits if any hook hangs
 *
 * Signal handling does not itself call `app.close()` — `app.enableShutdownHooks()` already wires
 * SIGTERM/SIGINT to Nest's own close sequence; this only adds the log line and the fallback timer,
 * unchanged from the pre-Phase-0 behavior other than now sharing the `shuttingDown` guard. Fatal
 * errors have no such built-in trigger, so this explicitly calls `app.close()` and always exits
 * (non-zero) once it settles — an unhandled rejection/exception is an actual bug, not a condition
 * to keep serving traffic under.
 */
export function registerProcessLifecycleHandlers(
  options: RegisterProcessLifecycleHandlersOptions,
): void {
  const { app, logger, context, shutdownTimeoutMs } = options;

  let shuttingDown = false;

  const armFallbackTimer = (event: string) => {
    const timer = setTimeout(() => {
      logger.error(
        { event: `${event}_shutdown_timeout`, shutdownTimeoutMs },
        undefined,
        context,
      );

      process.exit(1);
    }, shutdownTimeoutMs);

    timer.unref();

    return timer;
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      logger.log({ event: 'shutdown_signal_received', signal }, context);

      markRedisShuttingDown();

      // Safety net only — Nest's own SIGTERM/SIGINT listener (registered by
      // `app.enableShutdownHooks()`) performs the actual close(); if a lifecycle hook hangs,
      // force-exit within the orchestrator's grace period rather than waiting for a SIGKILL.
      armFallbackTimer('shutdown_signal');
    });
  }

  const handleFatalError =
    (event: 'unhandled_rejection' | 'uncaught_exception') =>
    (error: unknown) => {
      if (shuttingDown) {
        // A shutdown (signal- or error-triggered) is already in flight — avoid double-logging and
        // avoid arming a second fallback timer / calling app.close() twice.
        return;
      }
      shuttingDown = true;

      logger.error(
        {
          event,
          message: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        context,
      );

      markRedisShuttingDown();

      const fallback = armFallbackTimer(event);

      // No OS signal exists for a fatal in-process error, so Nest's own enableShutdownHooks()
      // listener never fires on its own here — trigger the same lifecycle close explicitly. This
      // still lets onModuleDestroy/onApplicationShutdown hooks (Redis, Socket.IO, BullMQ, Prisma)
      // run, rather than the process dying immediately with no cleanup.
      void app
        .close()
        .catch((closeError: Error) => {
          logger.error(
            { event: `${event}_shutdown_error`, message: closeError.message },
            closeError.stack,
            context,
          );
        })
        .finally(() => {
          clearTimeout(fallback);
          process.exit(1);
        });
    };

  process.on('unhandledRejection', handleFatalError('unhandled_rejection'));
  process.on('uncaughtException', handleFatalError('uncaught_exception'));
}
