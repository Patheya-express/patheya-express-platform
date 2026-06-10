import {
  Injectable,
} from '@nestjs/common';

import { PrismaService }
from '../../infrastructure/database/prisma.service';

import { AppLoggerService }
from '../../infrastructure/logger/logger.service';

import { RedisService }
from '../../infrastructure/redis/redis.service';

@Injectable()
export class HealthService {

  constructor(

    private readonly prisma:
      PrismaService,

    private readonly logger:
      AppLoggerService,

    private readonly redis:
      RedisService,

  ) {}

  async getHealthStatus() {

    await this.prisma
      .$queryRaw`SELECT 1`;

    const redisClient =
      this.redis.getClient();

    const redisStatus =
      await redisClient.ping();

    const memory =
      process.memoryUsage();

    const uptime =
      Math.floor(
        process.uptime(),
      );

    this.logger.log(

      {

        event:
          'health_check',

        database:
          'connected',

        redis:
          redisStatus,

      },

      'HealthService',

    );

    return {

      status: 'ok',

      service:
        'Patheya Express API',

      database:
        'connected',

      redis:
        redisStatus === 'PONG'
          ? 'connected'
          : 'disconnected',

      uptime,

      memory: {

        rss:
          memory.rss,

        heapUsed:
          memory.heapUsed,

        heapTotal:
          memory.heapTotal,

      },

      timestamp:
        new Date().toISOString(),

    };

  }

}