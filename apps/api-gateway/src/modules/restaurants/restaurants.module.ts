import { Module } from '@nestjs/common';

import { RestaurantsController } from './controllers/restaurants.controller';
import { CuisinesController } from './controllers/cuisines.controller';
import { ReviewsController } from './controllers/reviews.controller';

import { RestaurantsService } from './services/restaurants.service';
import { CuisinesService } from './services/cuisines.service';
import { ReviewsService } from './services/reviews.service';

import { RestaurantsRepository } from './repositories/restaurants.repository';
import { CuisinesRepository } from './repositories/cuisines.repository';
import { ReviewsRepository } from './repositories/reviews.repository';

import { OffersModule } from '../offers/offers.module';

@Module({
  imports: [OffersModule],

  controllers: [RestaurantsController, CuisinesController, ReviewsController],

  providers: [
    RestaurantsService,
    RestaurantsRepository,
    CuisinesService,
    CuisinesRepository,
    ReviewsService,
    ReviewsRepository,
  ],

  exports: [RestaurantsService, CuisinesService],
})
export class RestaurantsModule {}
