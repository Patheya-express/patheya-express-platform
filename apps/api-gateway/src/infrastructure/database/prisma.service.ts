import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { Prisma, PrismaClient } from '@prisma/client';

import { AppLoggerService } from '../logger/logger.service';

/** Production-validation observability finding: no slow-query visibility existed anywhere in
 *  this app. Deliberately a warn-only threshold, not full query logging — logging every query
 *  at debug level would be noise; this only surfaces the ones actually worth investigating. */
const SLOW_QUERY_THRESHOLD_MS = 200;

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly logger: AppLoggerService) {
    super({
      log: [{ emit: 'event', level: 'query' }],
    });
  }

  async onModuleInit() {
    this.$on('query', (event: Prisma.QueryEvent) => {
      if (event.duration >= SLOW_QUERY_THRESHOLD_MS) {
        this.logger.warn(
          {
            event: 'prisma_slow_query',
            durationMs: event.duration,
            query: event.query,
          },
          'PrismaService',
        );
      }
    });

    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const models = Reflect.ownKeys(this).filter((key) => {
      return key[0] !== '_' && key[0] !== '$';
    });

    return Promise.all(
      models.map((modelKey) => {
        return this[modelKey as string].deleteMany();
      }),
    );
  }
}
