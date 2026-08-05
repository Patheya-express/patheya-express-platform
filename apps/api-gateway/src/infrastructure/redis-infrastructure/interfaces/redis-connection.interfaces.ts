import type { Redis } from 'ioredis';

import { RedisConnectionType } from '../enums/redis-connection-type.enum';
import { RedisConnectionStatus } from '../enums/redis-connection-status.enum';

/** What `RedisConnectionFactory.createConnection`/`duplicateConnection` need to register a new
 *  client with `RedisConnectionRegistry`. */
export interface RegisterConnectionInput {
  name: string;
  type: RedisConnectionType;
  purpose: string;
  owner: string;
  client: Redis;
  host?: string;
  port?: number;
  database: number;
  tls: boolean;
  lazyConnect: boolean;
}

/** Internal registry record — includes the live client reference, never returned directly from
 *  a public method (see `RedisConnectionMetadata` for the read-only diagnostic view). */
export interface RedisConnectionRecord extends RegisterConnectionInput {
  createdAt: Date;
  status: RedisConnectionStatus;
  reconnectCount: number;
  errorCount: number;
  registrationCount: number;
  lastReconnectAt?: Date;
  lastError?: { message: string; occurredAt: Date };
}

/** Read-only diagnostic view of a registered connection — everything `RedisConnectionRecord`
 *  has except the live `client`, which `RedisHealthService`/future controllers should never
 *  need to touch directly. */
export type RedisConnectionMetadata = Omit<RedisConnectionRecord, 'client'>;
