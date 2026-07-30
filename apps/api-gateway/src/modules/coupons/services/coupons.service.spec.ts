import { NotFoundException } from '@nestjs/common';

import { CouponType, CouponScope, type Coupon } from '@prisma/client';

import { CouponsService } from './coupons.service';
import { PricingEngineService } from '../../pricing/pricing.service';
import { SubtotalCalculator } from '../../pricing/calculators/subtotal.calculator';
import { DeliveryFeeCalculator } from '../../pricing/calculators/delivery-fee.calculator';
import { TaxCalculator } from '../../pricing/calculators/tax.calculator';
import { CouponCalculator } from '../../pricing/calculators/coupon.calculator';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function buildCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'TEST50',
    name: 'Test Coupon',
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
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-12-31T23:59:59.000Z'),
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('CouponsService', () => {
  let service: CouponsService;
  let repository: {
    findByCode: jest.Mock;
    countUserRedemptions: jest.Mock;
    createRedemption: jest.Mock;
  };
  let pricingEngine: PricingEngineService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    repository = {
      findByCode: jest.fn(),
      countUserRedemptions: jest.fn().mockResolvedValue(0),
      createRedemption: jest.fn(),
    };

    // Real pricing engine (not mocked) — the whole point of these tests is verifying
    // CouponsService + the real CouponCalculator agree on eligibility and discount amounts.
    pricingEngine = new PricingEngineService(
      new SubtotalCalculator(),
      new DeliveryFeeCalculator(),
      new TaxCalculator(),
      new CouponCalculator(),
    );

    service = new CouponsService(repository as any, pricingEngine);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('assertUsable', () => {
    it('rejects an unknown code (invalid code)', async () => {
      repository.findByCode.mockResolvedValue(null);

      await expect(
        service.assertUsable('user-1', 'NOPE', 'restaurant-1', 500),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an inactive coupon', async () => {
      repository.findByCode.mockResolvedValue(buildCoupon({ active: false }));

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-1', 500),
      ).rejects.toThrow('no longer active');
    });

    it('rejects a coupon that has not started yet', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({ startsAt: new Date('2026-07-01T00:00:00.000Z') }),
      );

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-1', 500),
      ).rejects.toThrow('not active yet');
    });

    it('rejects an expired coupon', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({ endsAt: new Date('2026-01-31T00:00:00.000Z') }),
      );

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-1', 500),
      ).rejects.toThrow('expired');
    });

    it('rejects when the subtotal is below minOrderAmount', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({
          minOrderAmount: 1000 as unknown as Coupon['minOrderAmount'],
        }),
      );

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-1', 500),
      ).rejects.toThrow('minimum order');
    });

    it('rejects a restaurant-scoped coupon used at a different restaurant', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({
          scope: CouponScope.RESTAURANT,
          restaurantId: 'restaurant-A',
        }),
      );

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-B', 500),
      ).rejects.toThrow('not valid for this restaurant');
    });

    it('accepts a restaurant-scoped coupon used at the matching restaurant', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({
          scope: CouponScope.RESTAURANT,
          restaurantId: 'restaurant-A',
        }),
      );

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-A', 500),
      ).resolves.toBeDefined();
    });

    it('rejects once the global usage limit is reached', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({ usageLimit: 10, totalUsed: 10 }),
      );

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-1', 500),
      ).rejects.toThrow('usage limit');
    });

    it('rejects a user who already redeemed up to their per-user limit', async () => {
      repository.findByCode.mockResolvedValue(buildCoupon({ usagePerUser: 1 }));
      repository.countUserRedemptions.mockResolvedValue(1);

      await expect(
        service.assertUsable('user-1', 'TEST50', 'restaurant-1', 500),
      ).rejects.toThrow('already redeemed');
    });
  });

  describe('validate — pricing preview', () => {
    it('computes a capped percentage discount', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({
          type: CouponType.PERCENTAGE,
          value: 20 as unknown as Coupon['value'],
          maxDiscountAmount: 50 as unknown as Coupon['maxDiscountAmount'],
        }),
      );

      const { pricing } = await service.validate('user-1', {
        code: 'TEST50',
        restaurantId: 'restaurant-1',
        subtotal: 500,
      });

      // 20% of 500 = 100, capped at 50.
      expect(pricing.discountAmount).toBe(50);
      expect(pricing.deliveryFee).toBe(40);
      expect(pricing.totalAmount).toBe(500 - 50 + 40 + 500 * 0.05);
    });

    it('computes a flat discount, capped at the subtotal', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({
          type: CouponType.FLAT,
          value: 1000 as unknown as Coupon['value'],
        }),
      );

      const { pricing } = await service.validate('user-1', {
        code: 'TEST50',
        restaurantId: 'restaurant-1',
        subtotal: 300,
      });

      expect(pricing.discountAmount).toBe(300);
    });

    it('zeroes the delivery fee for a FREE_DELIVERY coupon and leaves discountAmount at 0', async () => {
      repository.findByCode.mockResolvedValue(
        buildCoupon({ type: CouponType.FREE_DELIVERY }),
      );

      const { pricing } = await service.validate('user-1', {
        code: 'TEST50',
        restaurantId: 'restaurant-1',
        subtotal: 500,
      });

      expect(pricing.deliveryFee).toBe(0);
      expect(pricing.discountAmount).toBe(0);
      expect(pricing.totalAmount).toBe(500 + 0 + 500 * 0.05);
    });
  });
});
