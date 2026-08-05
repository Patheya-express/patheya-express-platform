import { Injectable } from '@nestjs/common';

export interface RedisMetricsSnapshot {
  connectionsCreated: number;
  activeConnections: number;
  reconnectCount: number;
  disconnectCount: number;
  authFailureCount: number;
  averagePingMs: number | null;
}

const AUTH_FAILURE_PATTERNS = [
  'NOAUTH',
  'WRONGPASS',
  'invalid password',
  'ERR Client sent AUTH',
];
const LATENCY_SAMPLE_WINDOW = 100;

/**
 * In-memory counters only — no Prometheus export (that stays `MetricsService`'s job; this sprint
 * doesn't touch it). Nothing calls these `record*` methods yet since no existing consumer is
 * wired to `RedisLifecycleService`/`RedisConnectionFactory`; they activate automatically once a
 * future sprint migrates a real client onto them. `recordCommandLatency` is a framework hook
 * only — wiring it to real per-command ioredis timings is itself a future migration step, not
 * done here.
 */
@Injectable()
export class RedisMetricsService {
  private connectionsCreated = 0;
  private activeConnections = 0;
  private reconnectCount = 0;
  private disconnectCount = 0;
  private authFailureCount = 0;
  private readonly latencySamples: number[] = [];

  recordConnectionCreated(): void {
    this.connectionsCreated += 1;
    this.activeConnections += 1;
  }

  recordDisconnect(): void {
    this.disconnectCount += 1;
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  recordReconnect(): void {
    this.reconnectCount += 1;
  }

  recordError(error: Error): void {
    if (
      AUTH_FAILURE_PATTERNS.some((pattern) => error.message.includes(pattern))
    ) {
      this.authFailureCount += 1;
    }
  }

  recordLatencySample(latencyMs: number): void {
    this.latencySamples.push(latencyMs);

    if (this.latencySamples.length > LATENCY_SAMPLE_WINDOW) {
      this.latencySamples.shift();
    }
  }

  /** Framework hook for future per-command latency instrumentation. */
  recordCommandLatency(_command: string, latencyMs: number): void {
    this.recordLatencySample(latencyMs);
  }

  getSnapshot(): RedisMetricsSnapshot {
    const averagePingMs =
      this.latencySamples.length > 0
        ? this.latencySamples.reduce((sum, value) => sum + value, 0) /
          this.latencySamples.length
        : null;

    return {
      connectionsCreated: this.connectionsCreated,
      activeConnections: this.activeConnections,
      reconnectCount: this.reconnectCount,
      disconnectCount: this.disconnectCount,
      authFailureCount: this.authFailureCount,
      averagePingMs,
    };
  }
}
