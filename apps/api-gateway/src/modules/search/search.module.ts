import { Module } from '@nestjs/common';

import { SearchController } from './controllers/search.controller';
import { SearchService } from './services/search.service';
import { SearchRepository } from './repositories/search.repository';
import { TrendingSearchProcessor } from './jobs/trending-search.processor';
import { TrendingSearchBootstrap } from './jobs/trending-search.bootstrap';

import { RestaurantsModule } from '../restaurants/restaurants.module';
import { MenuModule } from '../menu/menu.module';

@Module({
  imports: [RestaurantsModule, MenuModule],

  controllers: [SearchController],

  providers: [
    SearchService,
    SearchRepository,
    TrendingSearchProcessor,
    TrendingSearchBootstrap,
  ],

  exports: [SearchService],
})
export class SearchModule {}
