import { Module } from '@nestjs/common';

import { PricingEngineService } from './pricing.service';

import { SubtotalCalculator } from './calculators/subtotal.calculator';
import { DeliveryFeeCalculator } from './calculators/delivery-fee.calculator';
import { TaxCalculator } from './calculators/tax.calculator';
import { CouponCalculator } from './calculators/coupon.calculator';

@Module({
  providers: [
    PricingEngineService,
    SubtotalCalculator,
    DeliveryFeeCalculator,
    TaxCalculator,
    CouponCalculator,
  ],

  exports: [PricingEngineService],
})
export class PricingModule {}
