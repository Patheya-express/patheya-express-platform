import { Injectable, Logger } from '@nestjs/common';

import { RedisConnectionStatus } from './enums/redis-connection-status.enum';

import {
  RedisConnectionMetadata,
  RedisConnectionRecord,
  RegisterConnectionInput,
} from './interfaces/redis-connection.interfaces';

const DISCONNECTED_STATUSES = new Set([
  RedisConnectionStatus.CLOSED,
  RedisConnectionStatus.ENDED,
  RedisConnectionStatus.ERROR,
]);

/** Maps ioredis's own `client.status` string to our status enum, for connections that may
 *  already be past `connect`/`ready` by the time they're registered — e.g. a `QueueEvents`
 *  connection, registered only once its `events.client` promise resolves, which happens *after*
 *  BullMQ has already waited for `ready` internally. Registering with a hardcoded `CONNECTING`
 *  in that case would be permanently wrong: our lifecycle listeners are attached after the fact
 *  and never see the `connect`/`ready` events that already fired on the underlying client. */
function mapIoredisStatus(status: string): RedisConnectionStatus {
  switch (status) {
    case 'connect':
      return RedisConnectionStatus.CONNECTED;
    case 'ready':
      return RedisConnectionStatus.READY;
    case 'reconnecting':
      return RedisConnectionStatus.RECONNECTING;
    case 'close':
      return RedisConnectionStatus.CLOSED;
    case 'end':
      return RedisConnectionStatus.ENDED;
    case 'wait':
    case 'connecting':
    default:
      return RedisConnectionStatus.CONNECTING;
  }
}

/**
 * Tracks every Redis connection created through `RedisConnectionFactory` — name, purpose,
 * type, owner, creation time, status, and error/reconnect history. Exposes only read-only
 * diagnostic views (`RedisConnectionMetadata`, never the live client) outside this service,
 * per Step 4's "must expose read-only diagnostics" requirement.
 *
 * Empty at runtime until a future sprint migrates an existing connection onto the factory —
 * that's expected, not a bug.
 */
@Injectable()
export class RedisConnectionRegistry {
  private readonly logger = new Logger(RedisConnectionRegistry.name);
  private readonly connections = new Map<string, RedisConnectionRecord>();

  register(input: RegisterConnectionInput): void {
    const existing = this.connections.get(input.name);
    const registrationCount = (existing?.registrationCount ?? 0) + 1;

    if (existing) {
      this.logger.warn(
        `Duplicate Redis connection name registered: "${input.name}" (registration #${registrationCount})`,
      );
    }

    this.connections.set(input.name, {
      ...input,
      createdAt: new Date(),
      status: mapIoredisStatus(input.client.status),
      reconnectCount: 0,
      errorCount: 0,
      registrationCount,
    });
  }

  updateStatus(name: string, status: RedisConnectionStatus): void {
    const record = this.connections.get(name);

    if (!record) {
      return;
    }

    record.status = status;
  }

  recordReconnect(name: string): void {
    const record = this.connections.get(name);

    if (!record) {
      return;
    }

    record.reconnectCount += 1;
    record.lastReconnectAt = new Date();
  }

  recordError(name: string, error: Error): void {
    const record = this.connections.get(name);

    if (!record) {
      return;
    }

    record.errorCount += 1;
    record.lastError = { message: error.message, occurredAt: new Date() };
  }

  unregister(name: string): void {
    this.connections.delete(name);
  }

  has(name: string): boolean {
    return this.connections.has(name);
  }

  get(name: string): RedisConnectionMetadata | undefined {
    const record = this.connections.get(name);
    return record ? this.toMetadata(record) : undefined;
  }

  getClient(name: string) {
    return this.connections.get(name)?.client;
  }

  getAll(): ReadonlyArray<RedisConnectionMetadata> {
    return Array.from(this.connections.values()).map((record) =>
      this.toMetadata(record),
    );
  }

  getDisconnected(): ReadonlyArray<RedisConnectionMetadata> {
    return this.getAll().filter((metadata) =>
      DISCONNECTED_STATUSES.has(metadata.status),
    );
  }

  findDuplicateNames(): string[] {
    return Array.from(this.connections.values())
      .filter((record) => record.registrationCount > 1)
      .map((record) => record.name);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  private toMetadata(record: RedisConnectionRecord): RedisConnectionMetadata {
    const { client: _client, ...metadata } = record;
    return metadata;
  }
}
