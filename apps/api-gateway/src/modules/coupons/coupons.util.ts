import { BadRequestException } from '@nestjs/common';

import type { Coupon } from '@prisma/client';

/**
 * Every eligibility rule a coupon must pass, in one place — shared by CouponsService.assertUsable
 * (the non-transactional preview used by `/coupons/validate` and OrdersService's early pricing
 * check) and CouponsRepository.reserveRedemption (the atomic, transactional re-check at actual
 * order placement — see that method's doc comment for why a second check is necessary). Keeping
 * the rules themselves defined exactly once, here, means the preview and the real gate can never
 * silently drift apart.
 */
export function assertCouponEligible(
  coupon: Coupon,
  restaurantId: string,
  subtotal: number,
  userRedemptionCount: number,
  now: Date,
): void {
  if (!coupon.active) {
    throw new BadRequestException('This coupon is no longer active');
  }

  if (now < coupon.startsAt) {
    throw new BadRequestException('This coupon is not active yet');
  }

  if (now > coupon.endsAt) {
    throw new BadRequestException('This coupon has expired');
  }

  if (subtotal < Number(coupon.minOrderAmount)) {
    throw new BadRequestException(
      `This coupon requires a minimum order of ₹${Number(coupon.minOrderAmount)}`,
    );
  }

  if (coupon.scope === 'RESTAURANT' && coupon.restaurantId !== restaurantId) {
    throw new BadRequestException(
      'This coupon is not valid for this restaurant',
    );
  }

  if (coupon.usageLimit !== null && coupon.totalUsed >= coupon.usageLimit) {
    throw new BadRequestException('This coupon has reached its usage limit');
  }

  if (userRedemptionCount >= coupon.usagePerUser) {
    throw new BadRequestException('You have already redeemed this coupon');
  }
}
