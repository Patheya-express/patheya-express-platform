import { Module } from '@nestjs/common';

import { SearchController } from './controllers/search.controller';
import { SearchService } from './services/search.service';

import { RestaurantsModule } from '../restaurants/restaurants.module';
import { MenuModule } from '../menu/menu.module';
import { SearchCoreModule } from './search-core.module';

/**
 * HTTP-facing half of the search feature — controller + `SearchService`. `SearchRepository`
 * lives in `SearchCoreModule`, shared with `SearchWorkerModule` rather than duplicated.
 * `TrendingSearchProcessor`/`TrendingSearchBootstrap` moved to `SearchWorkerModule` (imported
 * only by the worker process) so this module no longer instantiates a BullMQ Worker.
 */
@Module({
  imports: [RestaurantsModule, MenuModule, SearchCoreModule],

  controllers: [SearchController],

  providers: [SearchService],

  exports: [SearchService],
})
export class SearchModule {}
