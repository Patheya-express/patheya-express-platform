import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { SearchRepository } from '../repositories/search.repository';

const TRENDING_WINDOW_HOURS = 24;

@Processor('search')
export class TrendingSearchProcessor extends WorkerHost {
  constructor(private readonly searchRepository: SearchRepository) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'aggregate-trending-searches':
        await this.searchRepository.recomputeTrendingScores(
          TRENDING_WINDOW_HOURS,
        );

        break;
    }
  }
}
