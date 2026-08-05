import { Injectable, Optional } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

import { AppLoggerService } from '../../infrastructure/logger/logger.service';

import { RedisService } from '../../infrastructure/redis/redis.service';

import { QueueService } from '../../infrastructure/queues/queue.service';

import { StorageService } from '../storage/services/storage.service';

import { RealtimeService } from '../realtime/services/realtime.service';

import { HealthResponseDto } from './dto/health-response.dto';

import { LivenessResponseDto } from './dto/liveness-response.dto';

import { ReadinessResponseDto } from './dto/readiness-response.dto';

const HEALTH_CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly logger: AppLoggerService,

    private readonly redis: RedisService,

    private readonly queueService: QueueService,

    private readonly storage: StorageService,

    // Optional: worker-main.ts's slim WorkerModule imports HealthModule (for the same
    // /health/live,ready probe contract api-gateway uses) but not RealtimeModule — the worker
    // process never accepts WebSocket connections, so there is no gateway to be ready. `undefined`
    // here means getHealthStatus() reports `websocket: 'not_applicable'` rather than throwing.
    @Optional()
    private readonly realtime?: RealtimeService,
  ) {}

  async getHealthStatus(): Promise<HealthResponseDto> {
    const [databaseConnected, redisConnected, queuesConnected] =
      await Promise.all([
        this.checkDatabase(),
        this.checkRedis(),
        this.queueService.checkHealth(),
      ]);

    const memory = process.memoryUsage();

    const uptime = Math.floor(process.uptime());

    this.logger.log(
      {
        event: 'health_check',

        database: databaseConnected ? 'connected' : 'disconnected',

        redis: redisConnected ? 'connected' : 'disconnected',

        queues: queuesConnected ? 'connected' : 'disconnected',
      },

      'HealthService',
    );

    return {
      // Reflects the actual state of every dependency checked below — previously hardcoded to
      // 'ok' regardless of database/redis/queues state, which made this endpoint useless as a
      // Render/orchestrator health check target (see docs/deployment/render.md).
      status:
        databaseConnected && redisConnected && queuesConnected
          ? 'ok'
          : 'degraded',

      service: 'Patheya Express API',

      database: databaseConnected ? 'connected' : 'disconnected',

      redis: redisConnected ? 'connected' : 'disconnected',

      queues: queuesConnected ? 'connected' : 'disconnected',

      websocket: this.realtime
        ? this.realtime.isReady()
          ? 'ready'
          : 'not_ready'
        : 'not_applicable',

      uptime,

      memory: {
        rss: memory.rss,

        heapUsed: memory.heapUsed,

        heapTotal: memory.heapTotal,
      },

      timestamp: new Date().toISOString(),
    };
  }

  /** No dependency checks — see LivenessResponseDto's doc comment for why. */
  getLiveness(): LivenessResponseDto {
    return {
      status: 'ok',

      uptime: Math.floor(process.uptime()),

      timestamp: new Date().toISOString(),
    };
  }

  /** Checks every dependency an orchestrator needs before routing traffic to this instance:
   *  Database, Redis, and the BullMQ queues' Redis connections. */
  async getReadiness(): Promise<ReadinessResponseDto> {
    const [databaseConnected, redisConnected, queuesConnected, storageHealthy] =
      await Promise.all([
        this.checkDatabase(),
        this.checkRedis(),
        this.queueService.checkHealth(),
        this.storage.checkHealth(),
      ]);

    const allConnected =
      databaseConnected && redisConnected && queuesConnected && storageHealthy;

    return {
      status: allConnected ? 'ok' : 'degraded',

      database: databaseConnected ? 'connected' : 'disconnected',

      redis: redisConnected ? 'connected' : 'disconnected',

      queues: queuesConnected ? 'connected' : 'disconnected',

      storage: storageHealthy ? 'connected' : 'disconnected',

      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Production Readiness Stage A (Failure Injection finding): bounds every dependency probe below
   * to `HEALTH_CHECK_TIMEOUT_MS`, the same pattern `QueueService.checkHealth()` already used (its
   * own doc comment: "A 2-second timeout keeps an unreachable Redis from hanging the readiness
   * check indefinitely"). `checkRedis()` didn't have this before — verified against a real Redis
   * instance stopped mid-run: with `getRedisConnectionOptions()`'s `maxRetriesPerRequest: null`,
   * `redisClient.ping()` doesn't reject when disconnected, it queues forever waiting for
   * reconnection, so `/health/ready` hung indefinitely rather than reporting `degraded` — worse
   * than a fast failure, since an orchestrator's own probe timeout would eventually mark the pod
   * unready anyway, but every hung check left a request in flight until then. `checkDatabase()`
   * gets the same bound defensively, for the same reason, even though Prisma's own pool/connect
   * timeouts likely already bound it in practice.
   */
  private async withTimeout(
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await Promise.race([
        operation(),
        new Promise<boolean>((_, reject) =>
          setTimeout(
            () => reject(new Error('health check timed out')),
            HEALTH_CHECK_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch {
      return false;
    }
  }

  private async checkDatabase(): Promise<boolean> {
    return this.withTimeout(async () => {
      await this.prisma.$queryRaw`SELECT 1`;

      return true;
    });
  }

  private async checkRedis(): Promise<boolean> {
    return this.withTimeout(async () => {
      const redisClient = this.redis.getClient();

      const pong = await redisClient.ping();

      return pong === 'PONG';
    });
  }
}
