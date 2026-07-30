import { Module } from '@nestjs/common';

import { OffersService } from './services/offers.service';

import { OffersRepository } from './repositories/offers.repository';

/**
 * Controller-free core of the offers feature — needed by `RestaurantsCoreModule`
 * (`RestaurantsService` injects `OffersService` directly). Kept separate from `OffersModule`
 * (which owns `OffersController`) so importing it never pulls a controller into the Worker
 * process.
 */
@Module({
  providers: [OffersService, OffersRepository],

  exports: [OffersService, OffersRepository],
})
export class OffersCoreModule {}
