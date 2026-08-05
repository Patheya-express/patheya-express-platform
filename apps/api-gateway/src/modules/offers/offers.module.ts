import { Module } from '@nestjs/common';

import { OffersController } from './controllers/offers.controller';

import { OffersCoreModule } from './offers-core.module';

/**
 * HTTP-facing half of the offers feature — controller only. `OffersService`/`OffersRepository`
 * live in `OffersCoreModule`, re-exported here so existing consumers of `OffersModule` keep
 * working unchanged.
 */
@Module({
  imports: [OffersCoreModule],

  controllers: [OffersController],

  exports: [OffersCoreModule],
})
export class OffersModule {}
