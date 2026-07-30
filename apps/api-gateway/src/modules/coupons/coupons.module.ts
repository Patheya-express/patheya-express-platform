import { Module } from '@nestjs/common';

import { CouponsController } from './controllers/coupons.controller';

import { CouponsCoreModule } from './coupons-core.module';

/**
 * HTTP-facing half of the coupons feature — controller only. `CouponsService`/
 * `CouponsRepository` live in `CouponsCoreModule`, re-exported here so existing consumers of
 * `CouponsModule` keep working unchanged.
 */
@Module({
  imports: [CouponsCoreModule],

  controllers: [CouponsController],

  exports: [CouponsCoreModule],
})
export class CouponsModule {}
