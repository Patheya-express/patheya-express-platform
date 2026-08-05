import { RedisOptions } from 'ioredis';

import { getRedisConnectionOptions } from '../redis/redis-connection.config';

/**
 * Fluent builder for ioredis connection options, centralizing the knobs Infrastructure Sprint A
 * asked to be centralized (timeouts, retry limits, backoff, keepalive, TLS, authentication,
 * lazyConnect, offline queue, autoResubscribe, autoResendUnfulfilledCommands).
 *
 * `.default()` delegates to the existing `getRedisConnectionOptions()` so anything built from it
 * today is byte-identical to what `RedisService`/`QueueInfrastructureModule`/`RealtimeGateway`
 * already construct by calling that function directly — this builder adds no new connection
 * behavior, only a reusable way for future consumers to construct/override options.
 */
export class RedisConnectionOptionsBuilder {
  private options: RedisOptions;

  private constructor(base: RedisOptions) {
    this.options = { ...base };
  }

  static default(): RedisConnectionOptionsBuilder {
    return new RedisConnectionOptionsBuilder(getRedisConnectionOptions());
  }

  static blank(): RedisConnectionOptionsBuilder {
    return new RedisConnectionOptionsBuilder({});
  }

  withHost(host: string): this {
    this.options.host = host;
    return this;
  }

  withPort(port: number): this {
    this.options.port = port;
    return this;
  }

  withPassword(password: string | undefined): this {
    this.options.password = password;
    return this;
  }

  withDatabase(db: number): this {
    this.options.db = db;
    return this;
  }

  withTls(tls: RedisOptions['tls']): this {
    this.options.tls = tls;
    return this;
  }

  withRetryStrategy(fn: RedisOptions['retryStrategy']): this {
    this.options.retryStrategy = fn;
    return this;
  }

  withReconnectOnError(fn: RedisOptions['reconnectOnError']): this {
    this.options.reconnectOnError = fn;
    return this;
  }

  withMaxRetriesPerRequest(value: number | null): this {
    this.options.maxRetriesPerRequest = value;
    return this;
  }

  withConnectTimeout(ms: number): this {
    this.options.connectTimeout = ms;
    return this;
  }

  withKeepAlive(ms: number): this {
    this.options.keepAlive = ms;
    return this;
  }

  withLazyConnect(value: boolean): this {
    this.options.lazyConnect = value;
    return this;
  }

  withReadyCheck(value: boolean): this {
    this.options.enableReadyCheck = value;
    return this;
  }

  withOfflineQueue(value: boolean): this {
    this.options.enableOfflineQueue = value;
    return this;
  }

  withAutoResubscribe(value: boolean): this {
    this.options.autoResubscribe = value;
    return this;
  }

  withAutoResendUnfulfilledCommands(value: boolean): this {
    this.options.autoResendUnfulfilledCommands = value;
    return this;
  }

  build(): RedisOptions {
    return { ...this.options };
  }
}
