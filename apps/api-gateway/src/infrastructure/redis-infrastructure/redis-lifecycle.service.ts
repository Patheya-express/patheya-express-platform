import { Injectable, Logger } from '@nestjs/common';

import type { Redis } from 'ioredis';

import { RedisConnectionRegistry } from './redis-connection-registry.service';

import { RedisConnectionStatus } from './enums/redis-connection-status.enum';

import { RedisMetricsService } from './redis-metrics.service';

/**
 * Attaches the standard ioredis lifecycle listeners (`connect`/`ready`/`error`/`close`/`end`/
 * `reconnecting`) to every connection built through `RedisConnectionFactory`, wiring them into the
 * registry and metrics service. Purely observational — never alters client behavior or reconnect
 * logic.
 *
 * `attach()` is called by `RedisConnectionFactory.registerClient()` for every connection the
 * factory creates/duplicates/registers — currently `RedisService`'s general client, the Socket.IO
 * adapter's publisher/subscriber pair, and the BullMQ diagnostic/`QueueEvents` connections.
 *
 * `close(name)`/`shutdownAll()` gracefully `.quit()` a registered connection. Each connection's
 * *owner* is responsible for calling one of these at the right point in its own shutdown sequence
 * (mirroring how `RedisService`/`MetricsService` already close their own connections in their own
 * `onApplicationShutdown`/`onModuleDestroy` hooks) — see `RealtimeGateway.onApplicationShutdown()`
 * for the Socket.IO publisher/subscriber pair (Phase 0 remediation; previously unwired).
 */
@Injectable()
export class RedisLifecycleService {
  private readonly logger = new Logger(RedisLifecycleService.name);

  constructor(
    private readonly registry: RedisConnectionRegistry,
    private readonly metrics: RedisMetricsService,
  ) {}

  attach(client: Redis, name: string): void {
    client.on('connect', () => {
      this.registry.updateStatus(name, RedisConnectionStatus.CONNECTED);
      this.logger.log(`[${name}] connect`);
    });

    client.on('ready', () => {
      this.registry.updateStatus(name, RedisConnectionStatus.READY);
      this.logger.log(`[${name}] ready`);
    });

    client.on('error', (error: Error) => {
      this.registry.recordError(name, error);
      this.metrics.recordError(error);
      this.logger.error(`[${name}] error: ${error.message}`);
    });

    client.on('close', () => {
      this.registry.updateStatus(name, RedisConnectionStatus.CLOSED);
      this.metrics.recordDisconnect();
      this.logger.warn(`[${name}] close`);
    });

    client.on('end', () => {
      this.registry.updateStatus(name, RedisConnectionStatus.ENDED);
      this.logger.warn(`[${name}] end`);
    });

    client.on('reconnecting', (delay: number) => {
      this.registry.updateStatus(name, RedisConnectionStatus.RECONNECTING);
      this.registry.recordReconnect(name);
      this.metrics.recordReconnect();
      this.logger.warn(`[${name}] reconnecting in ${delay}ms`);
    });
  }

  /**
   * Gracefully closes a single registered connection by name. Safe to call more than once (a
   * missing/already-closed client is a no-op, not an error) and safe to call on a connection that
   * was never created (e.g. shutdown before `RealtimeGateway.afterInit()` ever ran) — both are
   * exactly the "shutdown must be idempotent" requirement this exists to satisfy.
   */
  async close(name: string): Promise<void> {
    const client = this.registry.getClient(name);

    if (!client) {
      return;
    }

    try {
      await client.quit();
    } catch (error) {
      this.logger.warn(
        `[${name}] error during shutdown: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Gracefully closes every connection currently in the registry. Intentionally not wired into
   * any global shutdown hook — most registered connections already have a specific owner that
   * closes them at the correct point in its own shutdown sequence (`RedisService`, `MetricsService`
   * for its `QueueEvents` listeners, `@nestjs/bullmq` for queue/worker connections); calling this
   * unconditionally on top of those would double-`.quit()` the same sockets. Kept for callers that
   * genuinely want a best-effort sweep of every connection this registry knows about (e.g. a
   * future diagnostic/ops script), and reuses the same per-client close as `close()` above.
   */
  async shutdownAll(): Promise<void> {
    const clients = this.registry.getAll();

    await Promise.all(clients.map((metadata) => this.close(metadata.name)));
  }
}
