import { Injectable, OnModuleInit } from '@nestjs/common';

import { QueueService } from '../../../infrastructure/queues/queue.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

@Injectable()
export class TrendingSearchBootstrap implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly logger: AppLoggerService,
  ) {}

  /** Production Readiness Stage D (Logging Audit): previously silent on both success and
   *  failure — see DispatchReconciliationBootstrap's doc comment for the same reasoning. */
  async onModuleInit() {
    try {
      await this.queueService.addTrendingSearchAggregationJob();

      this.logger.log(
        {
          event: 'scheduler_registered',
          scheduler: 'trending-search-aggregation',
        },
        'TrendingSearchBootstrap',
      );
    } catch (error) {
      this.logger.error(
        {
          event: 'scheduler_registration_failed',
          scheduler: 'trending-search-aggregation',
          reason: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        'TrendingSearchBootstrap',
      );

      throw error;
    }
  }
}
