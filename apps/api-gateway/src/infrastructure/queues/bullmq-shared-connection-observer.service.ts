import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { InjectQueue } from '@nestjs/bullmq';

import { Queue } from 'bullmq';

import type { Redis } from 'ioredis';

import { RedisConnectionFactory } from '../redis-infrastructure/redis-connection-factory.service';
import { RedisConnectionType } from '../redis-infrastructure/enums/redis-connection-type.enum';
import { RedisConnectionName } from '../redis-infrastructure/enums/redis-connection-name.enum';

/**
 * Registers a single diagnostic entry (`bullmq:shared`) representing the shared `RedisOptions`
 * template `QueueInfrastructureModule`'s `BullModule.forRoot({ connection: getRedisConnectionOptions() })`
 * hands to every BullMQ `Queue`/`Worker` in this process.
 *
 * IMPORTANT — audited directly against `bullmq`'s own source before writing this (Step 1's own
 * requirement): "shared" here describes the *configuration values*, not one live socket.
 * `forRoot`'s config object is a single JS object reference reused by every `registerQueue()`
 * call, but a plain options object is not `isRedisInstance()` — so each `Queue` and each
 * `Worker` (`RedisConnection`'s constructor, `bullmq/dist/cjs/classes/redis-connection.js`)
 * still independently calls `new IORedis(this.opts)`. `Worker` additionally opens a *second*,
 * always-dedicated `blockingConnection` for its blocking job-fetch loop (`worker.js`), which
 * `.duplicate()`s whatever `connection` it's given regardless. None of that changes here: this
 * process still opens exactly as many BullMQ-owned connections as it did before this file
 * existed (6 queues + 6 workers' main connections + 6 workers' blocking connections = 18,
 * unchanged) — this class creates zero new ones and closes zero existing ones. It only *observes*
 * one of those 18 (the `notifications` queue's own client — the same "one queue is representative
 * of all of them" choice `QueueService.checkHealth()` already makes, for the same reason: every
 * queue's connection is built from identical options) and registers it with
 * `RedisConnectionRegistry` so it's visible to health/metrics diagnostics.
 *
 * Declared as a provider of `QueueProducerModule` (not `QueueInfrastructureModule`) because that's
 * the module that actually has a `Queue` injected via `@InjectQueue` — `QueueInfrastructureModule`
 * only calls `BullModule.forRoot()` and has no queue instance of its own to observe. `owner` is
 * still recorded as `QueueInfrastructureModule` per this migration's spec: that's the logical
 * owner of the shared connection *template* this entry represents, not a claim about which file
 * the registration call happens to live in.
 */
@Injectable()
export class BullmqSharedConnectionObserver implements OnModuleInit {
  private readonly logger = new Logger(BullmqSharedConnectionObserver.name);

  constructor(
    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,
    private readonly redisConnectionFactory: RedisConnectionFactory,
  ) {}

  onModuleInit(): void {
    // Not awaited: `queue.client` only resolves once BullMQ has actually connected, and
    // onModuleInit must keep returning immediately regardless of Redis reachability — the same
    // non-blocking pattern MetricsService's QueueEvents registration uses.
    this.notificationQueue.client
      .then((client) => {
        this.redisConnectionFactory.registerExternalConnection(client as unknown as Redis, {
          name: RedisConnectionName.BULLMQ_SHARED,
          type: RedisConnectionType.BULLMQ_SHARED,
          owner: 'QueueInfrastructureModule',
          purpose: 'BullMQ shared queue connection',
        });
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to register BullMQ shared Redis connection: ${String(error)}`,
        );
      });
  }
}
