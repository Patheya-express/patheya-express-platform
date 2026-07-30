import { Module } from '@nestjs/common';

import { SearchRepository } from './repositories/search.repository';

/**
 * Controller-free core of the search feature — `SearchRepository`, shared as-is (not duplicated)
 * by both `SearchModule` (HTTP, via `SearchService`) and `SearchWorkerModule`
 * (`TrendingSearchProcessor`). Splitting this out lets the worker-side module depend on the
 * repository without also pulling `SearchController` into the worker process's HTTP surface.
 */
@Module({
  providers: [SearchRepository],

  exports: [SearchRepository],
})
export class SearchCoreModule {}
