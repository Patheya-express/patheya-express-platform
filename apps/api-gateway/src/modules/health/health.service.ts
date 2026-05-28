import {
  Injectable,
} from '@nestjs/common';

import { PrismaService }
from '../../infrastructure/database/prisma.service';

import { AppLoggerService }
from '../../infrastructure/logger/logger.service';

@Injectable()
export class HealthService {

  constructor(

    private readonly prisma:
      PrismaService,

    private readonly logger:
      AppLoggerService,

  ) {}

  async getHealthStatus() {

    await this.prisma
      .$queryRaw`SELECT 1`;

    this.logger.log(

      'Health check executed',

      'HealthService',

    );

    return {

      status: 'ok',

      database: 'connected',

      service:
        'Patheya Express API',

      timestamp:
        new Date().toISOString(),

    };

  }

}