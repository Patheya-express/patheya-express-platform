import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { Prisma, PrismaClient } from '@prisma/client';

import { AppLoggerService } from '../logger/logger.service';

import { MetricsService } from '../../modules/metrics/metrics.service';

/** Production-validation observability finding: no slow-query visibility existed anywhere in
 *  this app. Deliberately a warn-only threshold, not full query logging — logging every query
 *  at debug level would be noise; this only surfaces the ones actually worth investigating. */
const SLOW_QUERY_THRESHOLD_MS = 200;

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly logger: AppLoggerService,
    private readonly metrics: MetricsService,
  ) {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    this.$on('query', (event: Prisma.QueryEvent) => {
      // Production Readiness Stage B (Observability): every query already flows through here for
      // the slow-query log line — recording its duration into a histogram too is additive, not a
      // new hook. Not labeled by model/action: `event.query` is raw SQL text, not a structured
      // model/action pair, and reliably recovering them would need a Prisma Client Extension
      // (`$extends`), a larger change than this sprint's "instrument, don't redesign" scope.
      this.metrics.observePrismaQueryDuration(event.duration / 1000);

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

    // Prisma's `error` log level fires for engine-level errors (e.g. a lost connection) — not
    // every application-level query failure (those reject the calling `await` directly and are
    // handled by whichever service issued them), but it's the only failure signal Prisma itself
    // emits as an event, and is honest about what it covers rather than claiming full coverage.
    this.$on('error', (event: Prisma.LogEvent) => {
      this.metrics.recordPrismaQueryError();

      this.logger.error(
        {
          event: 'prisma_error',
          message: event.message,
        },
        undefined,
        'PrismaService',
      );
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
