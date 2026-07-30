import { RedisOptions } from 'ioredis';

/**
 * Shared by `RedisService`, `QueueInfrastructureModule`'s `BullModule.forRoot`, and `RealtimeGateway`'s pub/sub
 * adapter clients — one place defining how every Redis connection in this process authenticates
 * and encrypts, matching `modules/eks-addons/external-secrets.tf`'s `backend-redis-credentials`
 * Secret exactly (`REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH_TOKEN`/`REDIS_TLS`) — ElastiCache has
 * `transit_encryption_enabled = true` and an AUTH token (`modules/elasticache/main.tf`), so a
 * plain unauthenticated, unencrypted connection is rejected by the cluster, not just insecure.
 */
export function getRedisConnectionOptions(): RedisOptions {
  const tlsEnabled = process.env.REDIS_TLS === 'true';

  return {
    host: process.env.REDIS_HOST,

    port: Number(process.env.REDIS_PORT),

    // Absent in local development (docker-compose's plain Redis has no AUTH) — ioredis treats an
    // undefined password as "don't authenticate," which is exactly the local-dev behavior wanted.
    password: process.env.REDIS_AUTH_TOKEN || undefined,

    // `tls: {}` (default trust store) is sufficient — ElastiCache's certificate is signed by
    // Amazon Trust Services, a publicly trusted CA Node's default store already recognizes.
    tls: tlsEnabled ? {} : undefined,

    // Exponential backoff, capped at 2s — matches the platform's own BullMQ job-retry convention
    // (docs/architecture/platform-standards.md Section 17: "exponential backoff, base 2 seconds")
    // applied here to the connection itself, not a job.
    retryStrategy: (times: number) => Math.min(times * 50, 2000),

    // ElastiCache's own automatic failover (replicas_per_shard > 0) briefly returns READONLY to
    // a client still pointed at the old primary during promotion — reconnecting (which re-resolves
    // the endpoint) rather than surfacing the error to the caller is what makes that transition
    // transparent to the application, per platform-standards.md's expectation that Redis
    // AUTH-token rotation and failover both stay reconnect-transparent.
    reconnectOnError: (err: Error) => err.message.includes('READONLY'),

    maxRetriesPerRequest: null, // required by BullMQ's own connection contract; harmless for RedisService's direct use
  };
}
