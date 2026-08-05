import { Injectable, Logger } from '@nestjs/common';

import Redis, { RedisOptions } from 'ioredis';

import { RedisConnectionType } from './enums/redis-connection-type.enum';

import { RedisConnectionRegistry } from './redis-connection-registry.service';

import { RedisLifecycleService } from './redis-lifecycle.service';

import { RedisConfigurationService } from './redis-configuration.service';

import { RedisMetricsService } from './redis-metrics.service';

export interface CreateConnectionParams {
  name: string;
  type: RedisConnectionType;
  purpose: string;
  owner: string;
  overrides?: Partial<RedisOptions>;
}

export interface DuplicateConnectionParams {
  name: string;
  type: RedisConnectionType;
  purpose: string;
  owner: string;
}

export interface RegisterExternalConnectionParams {
  name: string;
  type: RedisConnectionType;
  purpose: string;
  owner: string;
}

/**
 * Central factory future sprints will call instead of `new Redis(...)` directly. Every
 * connection it creates is automatically registered (`RedisConnectionRegistry`), instrumented
 * (`RedisLifecycleService`/`RedisMetricsService`), and logged the same way.
 *
 * `createConnection()`/`duplicateConnection()` are for consumers that want the factory to
 * construct the client itself. `registerExternalConnection()` is for consumers where a *third
 * party* must own construction — the migration guide below is why that distinction matters.
 *
 * Migration note (BullMQ `QueueEvents`): passing an already-constructed `ioredis` instance as
 * `QueueEvents`'s `connection` option does **not** reuse that instance — `QueueEvents`'s own
 * constructor unconditionally calls `.duplicate()` on any live instance it's handed (verified in
 * `bullmq`'s `classes/queue-events.js`), to guarantee itself a dedicated connection for its
 * blocking stream reads. Calling `createConnection()` and passing the result to `QueueEvents`
 * would therefore silently create a *second*, unregistered/uninstrumented connection (the
 * duplicate `QueueEvents` actually uses) while leaving the first one — the one this factory
 * registered — open and never closed by `QueueEvents.close()` (which only ever quits its own
 * `_client`, i.e. the duplicate). That's both a duplicate-connection and an orphan-connection bug.
 * The correct pattern is: let `QueueEvents` construct its own connection from plain options
 * (exactly as before any migration), then `await queueEvents.client` (BullMQ's own public
 * accessor for the client it created) and hand that real, single, BullMQ-owned client to
 * `registerExternalConnection()` — observing and instrumenting it without constructing a second
 * connection or interfering with BullMQ's ownership of closing it.
 */
@Injectable()
export class RedisConnectionFactory {
  private readonly logger = new Logger(RedisConnectionFactory.name);

  constructor(
    private readonly configuration: RedisConfigurationService,
    private readonly registry: RedisConnectionRegistry,
    private readonly lifecycle: RedisLifecycleService,
    private readonly metrics: RedisMetricsService,
  ) {}

  createConnection(params: CreateConnectionParams): Redis {
    const options: RedisOptions = {
      ...this.configuration.getDefaultOptions(),
      ...params.overrides,
    };

    const client = new Redis(options);

    this.registerClient(client, params);

    this.logger.log(
      `Created Redis connection "${params.name}" (type=${params.type}, owner=${params.owner})`,
    );

    return client;
  }

  /** Mirrors the `.duplicate()` pattern `RealtimeGateway` already uses for its Socket.IO
   *  pub/sub pair — registers the duplicate under its own name rather than sharing the
   *  source's registry entry. */
  duplicateConnection(source: Redis, params: DuplicateConnectionParams): Redis {
    const client = source.duplicate();

    this.registerClient(client, params);

    this.logger.log(
      `Duplicated Redis connection "${params.name}" (type=${params.type}, owner=${params.owner})`,
    );

    return client;
  }

  /** Registers/instruments a client this factory did not construct — see the migration note
   *  above for why `QueueEvents` specifically must use this instead of `createConnection()`. */
  registerExternalConnection(
    client: Redis,
    params: RegisterExternalConnectionParams,
  ): void {
    this.registerClient(client, params);

    this.logger.log(
      `Registered externally-created Redis connection "${params.name}" (type=${params.type}, owner=${params.owner})`,
    );
  }

  private registerClient(
    client: Redis,
    params: {
      name: string;
      type: RedisConnectionType;
      purpose: string;
      owner: string;
    },
  ): void {
    const options = client.options;

    this.registry.register({
      name: params.name,
      type: params.type,
      purpose: params.purpose,
      owner: params.owner,
      client,
      host: options.host,
      port: options.port,
      database: options.db ?? 0,
      tls: Boolean(options.tls),
      lazyConnect: Boolean(options.lazyConnect),
    });

    this.lifecycle.attach(client, params.name);
    this.metrics.recordConnectionCreated();
  }
}
