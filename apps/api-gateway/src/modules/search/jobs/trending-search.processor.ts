import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { SearchRepository } from '../repositories/search.repository';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

const TRENDING_WINDOW_HOURS = 24;

@Processor('search')
export class TrendingSearchProcessor extends WorkerHost {
  constructor(
    private readonly searchRepository: SearchRepository,
    // Phase 3F-3 (Scheduled Job Observability): previously no logger of any kind existed in this
    // class — same structured logger every other scheduled-job event in this codebase already
    // uses, used here only for scheduled_job_completed/failed.
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'aggregate-trending-searches':
        await this.aggregateTrendingSearches();

        break;
    }
  }

  private async aggregateTrendingSearches(): Promise<void> {
    const startedAt = Date.now();

    try {
      // recomputeTrendingScores already returns the number of trending rows it upserted
      // (search.repository.ts) — previously discarded here; now the completion event's
      // resultCount, at no extra query cost.
      const resultCount = await this.searchRepository.recomputeTrendingScores(
        TRENDING_WINDOW_HOURS,
      );

      this.logger.log(
        {
          event: 'scheduled_job_completed',
          job: 'trending-search-aggregation',
          queue: 'search',
          durationMs: Date.now() - startedAt,
          resultCount,
        },
        'TrendingSearchProcessor',
      );
    } catch (error) {
      // Rethrown unchanged below — preserves BullMQ's existing retry/failure behavior exactly;
      // this only adds a job-scoped, duration-carrying, immediately-searchable failure record.
      this.logger.error(
        {
          event: 'scheduled_job_failed',
          job: 'trending-search-aggregation',
          queue: 'search',
          durationMs: Date.now() - startedAt,
          reason: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        'TrendingSearchProcessor',
      );

      throw error;
    }
  }
}
