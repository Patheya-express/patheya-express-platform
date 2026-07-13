import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

import { AppLoggerService } from '../../infrastructure/logger/logger.service';

import { RedisService } from '../../infrastructure/redis/redis.service';

import { QueueService } from '../../infrastructure/queues/queue.service';

import { HealthResponseDto } from './dto/health-response.dto';

import { LivenessResponseDto } from './dto/liveness-response.dto';

import { ReadinessResponseDto } from './dto/readiness-response.dto';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly logger: AppLoggerService,

    private readonly redis: RedisService,

    private readonly queueService: QueueService,
  ) {}

  async getHealthStatus(): Promise<HealthResponseDto> {
    const [databaseConnected, redisConnected] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const memory = process.memoryUsage();

    const uptime = Math.floor(process.uptime());

    this.logger.log(
      {
        event: 'health_check',

        database: databaseConnected ? 'connected' : 'disconnected',

        redis: redisConnected ? 'connected' : 'disconnected',
      },

      'HealthService',
    );

    return {
      status: 'ok',

      service: 'Patheya Express API',

      database: databaseConnected ? 'connected' : 'disconnected',

      redis: redisConnected ? 'connected' : 'disconnected',

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
    const [databaseConnected, redisConnected, queuesConnected] =
      await Promise.all([
        this.checkDatabase(),
        this.checkRedis(),
        this.queueService.checkHealth(),
      ]);

    const allConnected = databaseConnected && redisConnected && queuesConnected;

    return {
      status: allConnected ? 'ok' : 'degraded',

      database: databaseConnected ? 'connected' : 'disconnected',

      redis: redisConnected ? 'connected' : 'disconnected',

      queues: queuesConnected ? 'connected' : 'disconnected',

      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const redisClient = this.redis.getClient();

      const pong = await redisClient.ping();

      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
