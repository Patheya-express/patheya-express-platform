import { Injectable } from '@nestjs/common';

import { RedisConnectionRegistry } from './redis-connection-registry.service';

import { RedisMetricsService } from './redis-metrics.service';

export interface RedisConnectionPingResult {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Diagnostics over whatever connections are registered in `RedisConnectionRegistry`. No
 * controller wraps this yet (Step 6 is service-only) — a future sprint can expose it via a
 * health/readiness endpoint once real connections are migrated onto the registry.
 *
 * Reports on zero connections today, since nothing registers itself there yet. That's expected,
 * not a bug — this sprint is foundation only.
 */
@Injectable()
export class RedisHealthService {
  constructor(
    private readonly registry: RedisConnectionRegistry,
    private readonly metrics: RedisMetricsService,
  ) {}

  /**
   * Pings every registered connection in parallel, not sequentially — a `BULLMQ_QUEUE_EVENTS`
   * connection spends most of its time inside a blocking stream read (BullMQ's own 10s
   * `blockingTimeout`), so a `PING` issued at the wrong moment can wait up to that long for the
   * in-flight block to finish before it's serviced. Sequentially, N such connections could stack
   * up to N times that latency for the whole batch; in parallel, the worst case stays ~10s
   * regardless of how many connections are registered.
   */
  async pingAll(): Promise<RedisConnectionPingResult[]> {
    const pings = this.registry.getAll().map(async (metadata) => {
      const client = this.registry.getClient(metadata.name);

      if (!client) {
        return { name: metadata.name, healthy: false, error: 'client not found' };
      }

      const start = Date.now();

      try {
        await client.ping();

        const latencyMs = Date.now() - start;

        this.metrics.recordLatencySample(latencyMs);
        return { name: metadata.name, healthy: true, latencyMs };
      } catch (error) {
        return { name: metadata.name, healthy: false, error: (error as Error).message };
      }
    });

    return Promise.all(pings);
  }

  getDisconnected(): string[] {
    return this.registry.getDisconnected().map((metadata) => metadata.name);
  }

  getReconnectAttempts(name: string): number {
    return this.registry.get(name)?.reconnectCount ?? 0;
  }

  getFailedAuthentications(): number {
    return this.metrics.getSnapshot().authFailureCount;
  }

  getDuplicateConnectionNames(): string[] {
    return this.registry.findDuplicateNames();
  }
}
