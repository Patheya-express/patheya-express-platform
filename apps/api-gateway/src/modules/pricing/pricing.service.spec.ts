import { CouponType, CouponScope, type Coupon } from '@prisma/client';

import { PricingEngineService } from './pricing.service';
import { SubtotalCalculator } from './calculators/subtotal.calculator';
import { DeliveryFeeCalculator } from './calculators/delivery-fee.calculator';
import { TaxCalculator } from './calculators/tax.calculator';
import { CouponCalculator } from './calculators/coupon.calculator';

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'TEST',
    name: 'Test',
    description: null,
    type: CouponType.PERCENTAGE,
    value: 10 as unknown as Coupon['value'],
    maxDiscountAmount: null,
    minOrderAmount: 0 as unknown as Coupon['minOrderAmount'],
    scope: CouponScope.PLATFORM,
    restaurantId: null,
    usageLimit: null,
    usagePerUser: 1,
    totalUsed: 0,
    startsAt: new Date('2026-01-01'),
    endsAt: new Date('2026-12-31'),
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PricingEngineService', () => {
  let engine: PricingEngineService;

  beforeEach(() => {
    engine = new PricingEngineService(
      new SubtotalCalculator(),
      new DeliveryFeeCalculator(),
      new TaxCalculator(),
      new CouponCalculator(),
    );
  });

  it('preserves Sprint 2.2 behaviour exactly when no coupon is applied ("remove coupon")', () => {
    const result = engine.calculate([{ totalPrice: 400 }, { totalPrice: 100 }]);

    expect(result.subtotal).toBe(500);
    expect(result.deliveryFee).toBe(40);
    expect(result.taxAmount).toBe(25); // 5% of 500
    expect(result.discountAmount).toBe(0);
    expect(result.walletAmount).toBe(0);
    expect(result.platformFee).toBe(0);
    expect(result.totalAmount).toBe(500 + 40 + 25);
  });

  it('recalculates the total correctly once a percentage coupon is applied', () => {
    const coupon = buildCoupon({
      type: CouponType.PERCENTAGE,
      value: 10 as unknown as Coupon['value'],
    });

    const withoutCoupon = engine.calculate([{ totalPrice: 500 }]);
    const withCoupon = engine.calculate([{ totalPrice: 500 }], coupon);

    expect(withCoupon.discountAmount).toBe(50); // 10% of 500
    expect(withCoupon.totalAmount).toBe(withoutCoupon.totalAmount - 50);
    expect(withCoupon.deliveryFee).toBe(withoutCoupon.deliveryFee);
    expect(withCoupon.taxAmount).toBe(withoutCoupon.taxAmount);
  });

  it('only zeroes deliveryFee for FREE_DELIVERY, never discountAmount/taxAmount', () => {
    const coupon = buildCoupon({ type: CouponType.FREE_DELIVERY });

    const result = engine.calculate([{ totalPrice: 500 }], coupon);

    expect(result.deliveryFee).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.taxAmount).toBe(25);
    expect(result.totalAmount).toBe(500 + 0 + 25);
  });
});
