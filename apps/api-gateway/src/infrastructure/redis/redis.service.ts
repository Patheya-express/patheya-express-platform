import { Injectable, OnModuleDestroy } from '@nestjs/common';

import Redis from 'ioredis';

import { getRedisConnectionOptions } from './redis-connection.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(getRedisConnectionOptions());
  }

  getClient() {
    return this.redis;
  }

  async set(
    key: string,

    value: string,

    ttl?: number,
  ) {
    if (ttl) {
      await this.redis.set(key, value, 'EX', ttl);

      return;
    }

    await this.redis.set(key, value);
  }

  async get(key: string) {
    return this.redis.get(key);
  }

  async del(key: string) {
    return this.redis.del(key);
  }

  /**
   * Best-effort advisory lock (`SET key value NX PX ttlMs`) — used where correctness must NOT
   * depend on Redis (a durable DB-level constraint is always the real backstop; see
   * OrdersService.placeOrder). This is purely a fast-fail optimization for near-simultaneous
   * duplicate requests, so its two failure modes are deliberately distinguishable by callers:
   *  - Resolves `false`: the lock is genuinely held by another in-flight request right now.
   *  - Rejects (throws): Redis itself is unavailable/erroring — the caller should catch this and
   *    fall through to relying solely on the DB constraint, not treat it as "lock held."
   */
  async tryLock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /** Safe to call even if the lock was never acquired (e.g. Redis was down) — DEL on a missing key is a no-op. */
  async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
