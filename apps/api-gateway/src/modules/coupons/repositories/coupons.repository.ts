import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

import { CreateCouponDto } from '../dto/create-coupon.dto';
import { UpdateCouponDto } from '../dto/update-coupon.dto';
import { GetAdminCouponsQueryDto } from '../dto/get-admin-coupons-query.dto';
import { assertCouponEligible } from '../coupons.util';

@Injectable()
export class CouponsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByCode(code: string) {
    return this.prisma.coupon.findUnique({ where: { code } });
  }

  async findById(id: string) {
    return this.prisma.coupon.findUnique({ where: { id } });
  }

  async findAvailable(restaurantId?: string) {
    const now = new Date();

    return this.prisma.coupon.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        OR: [
          { scope: 'PLATFORM' },
          ...(restaurantId
            ? [{ scope: 'RESTAURANT' as const, restaurantId }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countUserRedemptions(couponId: string, userId: string) {
    return this.prisma.couponRedemption.count({ where: { couponId, userId } });
  }

  /**
   * Sprint 1.3 — the atomic redemption gate. Closes the TOCTOU race in the old
   * assertUsable-then-redeem split (see coupons.service.ts's doc comments): two concurrent
   * requests could each read `totalUsed < usageLimit` (or count 0 existing redemptions for the
   * same user) before either had written anything, both pass, and both redeem — overflowing the
   * limit.
   *
   *  - Total-usage limit: a conditional `updateMany` (`WHERE totalUsed < usageLimit`) is the
   *    actual claim, mirroring WalletRepository.applyToOrderAtomic. Postgres serializes concurrent
   *    UPDATEs to the same row at the row-lock level regardless of isolation level — a second
   *    concurrent UPDATE against the same row simply blocks until the first commits, then
   *    re-evaluates its WHERE clause against the now-current data — so whichever transaction
   *    commits first "wins" the claim and a losing concurrent request cleanly sees 0 affected
   *    rows. No separate `SELECT ... FOR UPDATE` needed, and — deliberately — no SERIALIZABLE
   *    isolation either (see below).
   *  - Per-user limit: the naive version of this method would count existing CouponRedemption
   *    rows and stop there — but a ledger row created only *after* the order exists (i.e. well
   *    after this transaction commits) gives a concurrent reservation attempt by the same user
   *    nothing to see, so two concurrent calls could both legitimately count 0 and both pass. This
   *    method closes that by creating the CouponRedemption row immediately, right here, atomically
   *    with the totalUsed claim — with `orderId` initially null (see the schema doc comment on
   *    CouponRedemption.orderId), filled in later once the order it belongs to actually exists
   *    (finalizeRedemption) or removed if that order attempt doesn't pan out (releaseRedemption).
   *    Correctness comes from a Postgres session-scoped advisory lock (`pg_advisory_xact_lock`,
   *    auto-released at commit/rollback) keyed on (code, userId): the second concurrent call for
   *    the same user blocks here until the first transaction ends, then re-reads a genuinely
   *    post-commit count. Scoped to one (coupon, user) pair — redemptions of a different coupon,
   *    or by a different user, never contend with each other on it. This is a real Postgres
   *    mechanism, not Redis, so it fits "database correctness must always win" — it isn't a cache
   *    or an optional optimization.
   *
   * Deliberately runs at Prisma's default (READ COMMITTED, Postgres's own default) rather than
   * SERIALIZABLE. Both mechanisms above are already correct without it — they're explicit,
   * blocking claims (a row-lock queue and an advisory lock), not reads that need SERIALIZABLE's
   * write-skew detection to catch after the fact. Measured under real concurrent load
   * (coupons.repository.concurrency.spec.ts) SERIALIZABLE actively made this worse: with many
   * transactions genuinely contending for the same coupon row (a popular coupon, not a rare
   * edge case — this is exactly "two different customers race for the last unit" at scale),
   * SERIALIZABLE's optimistic validation aborted a large fraction of them with serialization
   * failures (P2034) even though every one was legitimately eligible, exceeding
   * CouponsService.reserveRedemption's bounded retry and surfacing spurious errors to real
   * customers. READ COMMITTED with the two explicit claims above has no such retry storm — it
   * naturally queues instead. The one thing this trades away is protection against a concurrent
   * *admin* edit to this exact coupon's usageLimit mid-checkout — accepted as out of scope: far
   * rarer than customer-facing contention, and the retry wrapper remains as a safety net for
   * whatever transient failures still occur.
   */
  async reserveRedemption(params: {
    userId: string;
    code: string;
    restaurantId: string;
    subtotal: number;
  }): Promise<{
    coupon: Prisma.CouponGetPayload<object>;
    redemptionId: string;
  }> {
    return this.prisma.$transaction(async (tx) => {
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void, which Prisma's
      // result-set deserializer can't decode as a column type — $executeRaw only reports an
      // affected-row count and never tries to decode a result set, so it's the correct escape
      // hatch here regardless of this statement being a SELECT rather than DML.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.code}), hashtext(${params.userId}))`;

      const coupon = await tx.coupon.findUnique({
        where: { code: params.code },
      });

      if (!coupon) {
        throw new NotFoundException('Coupon not found');
      }

      const userRedemptions = await tx.couponRedemption.count({
        where: { couponId: coupon.id, userId: params.userId },
      });

      assertCouponEligible(
        coupon,
        params.restaurantId,
        params.subtotal,
        userRedemptions,
        new Date(),
      );

      const claim = await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          ...(coupon.usageLimit !== null
            ? { totalUsed: { lt: coupon.usageLimit } }
            : {}),
        },
        data: { totalUsed: { increment: 1 } },
      });

      if (claim.count === 0) {
        // Lost the race between the read above and this claim — vanishingly rare (the
        // eligibility check just confirmed room a moment ago) but still possible without a
        // second round-trip; same rejection a non-racing caller would get.
        throw new BadRequestException(
          'This coupon has reached its usage limit',
        );
      }

      const redemption = await tx.couponRedemption.create({
        data: {
          couponId: coupon.id,
          userId: params.userId,
          orderId: null,
          // Placeholder — finalizeRedemption sets the real, server-computed amount once the
          // order exists. Never read before then (releaseRedemption deletes the row outright
          // if the order attempt fails, rather than leaving a 0 lying around).
          discountAmount: 0,
        },
      });

      return { coupon, redemptionId: redemption.id };
    });
  }

  /**
   * Undoes a reserveRedemption() claim whose order attempt didn't pan out (lost an idempotency
   * race, or order creation failed outright) — deletes the placeholder ledger row and releases
   * the usage slot together, atomically, so a half-undone release can never leave totalUsed
   * decremented without removing the row (or vice versa).
   *
   * Reused as-is by Sprint 1.8's refund path (OrdersService.refundOrder ->
   * CouponsService.releaseForOrder) for a *completed* order's redemption too — deleting the
   * ledger row on refund is consistent with this method's existing meaning ("this usage no
   * longer counts"), not a new behavior. Deleting a row that's already gone throws Prisma's
   * P2025, which callers treat as an idempotent no-op — see releaseForOrder.
   */
  async releaseRedemption(couponId: string, redemptionId: string) {
    await this.prisma.$transaction([
      this.prisma.couponRedemption.delete({ where: { id: redemptionId } }),
      this.prisma.coupon.update({
        where: { id: couponId },
        data: { totalUsed: { decrement: 1 } },
      }),
    ]);
  }

  /** orderId is @unique on CouponRedemption — at most one row can ever match. */
  async findRedemptionByOrderId(orderId: string) {
    return this.prisma.couponRedemption.findUnique({ where: { orderId } });
  }

  /** Links the already-reserved ledger row to the real order and sets its final,
   *  server-computed discount amount — the usage slot itself was already claimed by
   *  reserveRedemption(). */
  async finalizeRedemption(
    redemptionId: string,
    orderId: string,
    discountAmount: number,
  ) {
    return this.prisma.couponRedemption.update({
      where: { id: redemptionId },
      data: { orderId, discountAmount },
    });
  }

  async create(dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        value: dto.value,
        maxDiscountAmount: dto.maxDiscountAmount,
        minOrderAmount: dto.minOrderAmount ?? 0,
        scope: dto.scope ?? 'PLATFORM',
        restaurantId: dto.restaurantId,
        usageLimit: dto.usageLimit,
        usagePerUser: dto.usagePerUser ?? 1,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateCouponDto) {
    return this.prisma.coupon.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        value: dto.value,
        maxDiscountAmount: dto.maxDiscountAmount,
        minOrderAmount: dto.minOrderAmount,
        scope: dto.scope,
        restaurantId: dto.restaurantId,
        usageLimit: dto.usageLimit,
        usagePerUser: dto.usagePerUser,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        active: dto.active,
      },
    });
  }

  async setActive(id: string, active: boolean) {
    return this.prisma.coupon.update({ where: { id }, data: { active } });
  }

  async delete(id: string) {
    return this.prisma.coupon.delete({ where: { id } });
  }

  async findAllForAdmin(query: GetAdminCouponsQueryDto) {
    const where: Prisma.CouponWhereInput = {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.coupon.count({ where }),
    ]);

    return { items, total };
  }
}
