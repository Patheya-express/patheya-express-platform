import { Module } from '@nestjs/common';

import { RestaurantsService } from './services/restaurants.service';

import { RestaurantsRepository } from './repositories/restaurants.repository';

import { OffersCoreModule } from '../offers/offers-core.module';
import { AuditCoreModule } from '../audit/audit-core.module';

/**
 * Controller-free core of the restaurants feature — just `RestaurantsService`/
 * `RestaurantsRepository`, the only piece `OrdersCoreModule` needs (`OrdersService` injects
 * `RestaurantsService` directly). The other dozen Restaurants sub-features (Cuisines, Reviews,
 * Branches, Staff, Documents, TaxProfile, BankAccount, Verification, Media, Compliance,
 * Settings, OperatingHours, Holidays) stay in `RestaurantsModule` exactly as before — nothing
 * outside that module used them, so there's no reason to move them.
 */
@Module({
  imports: [OffersCoreModule, AuditCoreModule],

  providers: [RestaurantsService, RestaurantsRepository],

  exports: [RestaurantsService, RestaurantsRepository],
})
export class RestaurantsCoreModule {}
