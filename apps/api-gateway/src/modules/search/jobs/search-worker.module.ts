import { Module } from '@nestjs/common';

import { TrendingSearchProcessor } from './trending-search.processor';
import { TrendingSearchBootstrap } from './trending-search.bootstrap';

import { SearchCoreModule } from '../search-core.module';

/**
 * Worker-only half of the search feature. Imported solely by `QueueWorkerModule` (never by
 * `AppModule`), so `TrendingSearchProcessor` and its repeatable-job bootstrap only run in the
 * dedicated worker process — closing the audit finding that this processor previously existed
 * only in the API process. Depends on `SearchCoreModule` for `SearchRepository` rather than
 * duplicating it.
 */
@Module({
  imports: [SearchCoreModule],

  providers: [TrendingSearchProcessor, TrendingSearchBootstrap],
})
export class SearchWorkerModule {}
