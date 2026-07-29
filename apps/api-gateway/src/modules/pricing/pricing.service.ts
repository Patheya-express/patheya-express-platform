import { Injectable } from '@nestjs/common';

import type { Coupon } from '@prisma/client';

import {
  SubtotalCalculator,
  type PricableOrderItem,
} from './calculators/subtotal.calculator';
import { DeliveryFeeCalculator } from './calculators/delivery-fee.calculator';
import { TaxCalculator } from './calculators/tax.calculator';
import { CouponCalculator } from './calculators/coupon.calculator';
import type { PricingResult } from './dto/pricing-result.dto';

/**
 * Single source of truth for order pricing — every amount that ends up on an Order (subtotal,
 * delivery fee, tax, discount, and eventually wallet/platform fee) is computed here, never inline
 * in OrdersService. OrdersService still owns resolving each line item's price (menu item lookup,
 * variant/addon validation) since that's order-construction, not pricing; it hands the resolved
 * items to `calculate()` and gets back one PricingResult to persist.
 *
 * Pipeline: Subtotal -> Coupon -> Delivery Fee -> Tax -> Wallet -> Platform Fee -> Total.
 * CouponCalculator is the only calculator that reads a coupon, and it may only influence
 * `discountAmount` and (for FREE_DELIVERY) `deliveryFee` — every other calculator here is
 * unchanged from before coupons existed and stays unaware coupons exist at all.
 *
 * Adding a new pricing concern (wallet, referral rewards, restaurant/platform promotions,
 * distance/dynamic pricing, service fees) means adding one new calculator class under
 * calculators/ and one new step in `calculate()` below — the calculators that already exist, and
 * every existing caller of `calculate()`, are untouched.
 */
@Injectable()
export class PricingEngineService {
  constructor(
    private readonly subtotalCalculator: SubtotalCalculator,
    private readonly deliveryFeeCalculator: DeliveryFeeCalculator,
    private readonly taxCalculator: TaxCalculator,
    private readonly couponCalculator: CouponCalculator,
  ) {}

  calculate(items: PricableOrderItem[], coupon?: Coupon | null): PricingResult {
    const subtotal = this.subtotalCalculator.calculate(items);
    const couponResult = this.couponCalculator.calculate(subtotal, coupon);
    const baseDeliveryFee = this.deliveryFeeCalculator.calculate();
    const deliveryFee = couponResult.freeDelivery ? 0 : baseDeliveryFee;
    const taxAmount = this.taxCalculator.calculate(subtotal);
    const discountAmount = couponResult.discountAmount;

    // Reserved for future calculators — see calculators/ and the class doc comment above. Kept
    // as explicit named terms in the total (rather than omitted) so adding a real calculator
    // later is a one-line change here, not a formula rewrite.
    const walletAmount = 0;
    const platformFee = 0;

    const totalAmount =
      subtotal -
      discountAmount +
      deliveryFee +
      taxAmount +
      platformFee -
      walletAmount;

    const pricingBreakdown = [
      { label: 'Subtotal', amount: subtotal },
      ...(discountAmount > 0
        ? [{ label: 'Discount', amount: -discountAmount }]
        : []),
      { label: 'Delivery Fee', amount: deliveryFee },
      { label: 'Tax', amount: taxAmount },
      { label: 'Total', amount: totalAmount },
    ];

    return {
      subtotal,
      deliveryFee,
      taxAmount,
      discountAmount,
      walletAmount,
      platformFee,
      totalAmount,
      pricingBreakdown,
    };
  }
}
