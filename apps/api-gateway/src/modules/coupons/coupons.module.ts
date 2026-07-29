import { Module } from '@nestjs/common';

import { CouponsController } from './controllers/coupons.controller';

import { CouponsService } from './services/coupons.service';

import { CouponsRepository } from './repositories/coupons.repository';

import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule],

  controllers: [CouponsController],

  providers: [CouponsService, CouponsRepository],

  exports: [CouponsService],
})
export class CouponsModule {}
