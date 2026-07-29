import { Injectable } from '@nestjs/common';

import { CouponType, type Coupon } from '@prisma/client';

export interface CouponCalculationResult {
  discountAmount: number;
  /** True only for an applied FREE_DELIVERY coupon — PricingEngineService zeroes the delivery fee when this is true. */
  freeDelivery: boolean;
}

/**
 * The only calculator that reads a Coupon — every other calculator in this engine stays entirely
 * unaware coupons exist. Given no coupon (the default), always returns a no-op result, so
 * `PricingEngineService.calculate()` behaves identically to before this calculator existed.
 */
@Injectable()
export class CouponCalculator {
  calculate(subtotal: number, coupon?: Coupon | null): CouponCalculationResult {
    if (!coupon) {
      return { discountAmount: 0, freeDelivery: false };
    }

    if (coupon.type === CouponType.FREE_DELIVERY) {
      return { discountAmount: 0, freeDelivery: true };
    }

    if (coupon.type === CouponType.FLAT) {
      const discountAmount = Math.min(Number(coupon.value), subtotal);
      return { discountAmount, freeDelivery: false };
    }

    // PERCENTAGE
    const rawDiscount = subtotal * (Number(coupon.value) / 100);
    const cappedDiscount =
      coupon.maxDiscountAmount != null
        ? Math.min(rawDiscount, Number(coupon.maxDiscountAmount))
        : rawDiscount;

    return {
      discountAmount: Math.min(cappedDiscount, subtotal),
      freeDelivery: false,
    };
  }
}
