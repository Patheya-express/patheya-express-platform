import { CouponScope, CouponType, PrismaClient } from '@prisma/client';

/**
 * A small, fixed set of developer coupons — one of each CouponType/CouponScope combination that
 * matters for exercising CouponsService.validate/reserveRedemption locally, without depending on
 * any restaurant beyond paradise-biryani (already the seed's canonical customer-facing demo
 * restaurant, see 09-orders.seed.ts). Dates are fixed (not relative to the seed run time) so the
 * dataset stays deterministic across runs and machines.
 */
const COUPONS: Array<{
  code: string;
  name: string;
  description: string;
  type: CouponType;
  value: number;
  maxDiscountAmount?: number;
  minOrderAmount: number;
  scope: CouponScope;
  restaurantSlug?: string;
  usageLimit?: number;
  usagePerUser: number;
  startsAt: Date;
  endsAt: Date;
}> = [
  {
    code: 'WELCOME50',
    name: 'Welcome Offer',
    description: 'Flat ₹50 off on your first order.',
    type: CouponType.FLAT,
    value: 50,
    minOrderAmount: 199,
    scope: CouponScope.PLATFORM,
    usagePerUser: 1,
    startsAt: new Date('2025-01-01T00:00:00.000Z'),
    endsAt: new Date('2030-12-31T23:59:59.000Z'),
  },
  {
    code: 'FESTIVE20',
    name: 'Festive Season 20% Off',
    description: '20% off, capped at ₹100, on orders above ₹299.',
    type: CouponType.PERCENTAGE,
    value: 20,
    maxDiscountAmount: 100,
    minOrderAmount: 299,
    scope: CouponScope.PLATFORM,
    usagePerUser: 1,
    startsAt: new Date('2025-01-01T00:00:00.000Z'),
    endsAt: new Date('2030-12-31T23:59:59.000Z'),
  },
  {
    code: 'PARADISE100',
    name: 'Paradise Biryani ₹100 Off',
    description: 'Flat ₹100 off at Paradise Biryani on orders above ₹399.',
    type: CouponType.FLAT,
    value: 100,
    minOrderAmount: 399,
    scope: CouponScope.RESTAURANT,
    restaurantSlug: 'paradise-biryani',
    usagePerUser: 1,
    startsAt: new Date('2025-01-01T00:00:00.000Z'),
    endsAt: new Date('2030-12-31T23:59:59.000Z'),
  },
];

export async function seedCoupons(prisma: PrismaClient): Promise<void> {
  console.log('🎟️  Seeding coupons...');

  let couponCount = 0;

  for (const coupon of COUPONS) {
    let restaurantId: string | undefined;

    if (coupon.restaurantSlug) {
      const restaurant = await prisma.restaurant.findUnique({
        where: { slug: coupon.restaurantSlug },
        select: { id: true },
      });

      if (!restaurant) {
        console.log(
          `⚠️  Skipping coupon ${coupon.code} — restaurant "${coupon.restaurantSlug}" not found.`,
        );
        continue;
      }

      restaurantId = restaurant.id;
    }

    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {},
      create: {
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        maxDiscountAmount: coupon.maxDiscountAmount,
        minOrderAmount: coupon.minOrderAmount,
        scope: coupon.scope,
        restaurantId,
        usageLimit: coupon.usageLimit,
        usagePerUser: coupon.usagePerUser,
        startsAt: coupon.startsAt,
        endsAt: coupon.endsAt,
        active: true,
      },
    });

    couponCount++;
  }

  console.log(`✅ ${couponCount} coupons seeded.`);
}
