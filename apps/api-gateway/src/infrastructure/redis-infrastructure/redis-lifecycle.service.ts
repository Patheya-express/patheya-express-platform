import { Injectable, Logger } from '@nestjs/common';

import type { Redis } from 'ioredis';

import { RedisConnectionRegistry } from './redis-connection-registry.service';

import { RedisConnectionStatus } from './enums/redis-connection-status.enum';

import { RedisMetricsService } from './redis-metrics.service';

/**
 * Attaches the standard ioredis lifecycle listeners (`connect`/`ready`/`error`/`close`/`end`/
 * `reconnecting`) a future-migrated connection should have, wiring them into the registry and
 * metrics service. Purely observational — never alters client behavior or reconnect logic.
 *
 * `attach()` is not called by any existing consumer yet; `RedisConnectionFactory` calls it for
 * every connection it creates, so it activates automatically once something starts using the
 * factory. `shutdownAll()` is likewise not wired into any application shutdown hook yet — a
 * future sprint will call it once real consumers are registered here.
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

  /** Gracefully closes every connection currently in the registry. */
  async shutdownAll(): Promise<void> {
    const clients = this.registry.getAll();

    await Promise.all(
      clients.map(async (metadata) => {
        const client = this.registry.getClient(metadata.name);

        if (!client) {
          return;
        }

        try {
          await client.quit();
        } catch (error) {
          this.logger.warn(
            `[${metadata.name}] error during shutdown: ${(error as Error).message}`,
          );
        }
      }),
    );
  }
}
