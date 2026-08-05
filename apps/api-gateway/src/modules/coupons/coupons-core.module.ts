import { Module } from '@nestjs/common';

import { CouponsService } from './services/coupons.service';

import { CouponsRepository } from './repositories/coupons.repository';

import { PricingModule } from '../pricing/pricing.module';

/**
 * Controller-free core of the coupons feature — needed by `OrdersCoreModule` (`OrdersService`
 * injects `CouponsService` directly). Kept separate from `CouponsModule` (which owns
 * `CouponsController`) so importing it never pulls a controller into the Worker process.
 * `PricingModule` has no controller of its own, so it's imported as-is (unchanged).
 */
@Module({
  imports: [PricingModule],

  providers: [CouponsService, CouponsRepository],

  exports: [CouponsService, CouponsRepository],
})
export class CouponsCoreModule {}
