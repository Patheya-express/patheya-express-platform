import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { Coupon } from '@prisma/client';

import { PricingEngineService } from '../../pricing/pricing.service';

import { CouponsRepository } from '../repositories/coupons.repository';

import { CreateCouponDto } from '../dto/create-coupon.dto';
import { UpdateCouponDto } from '../dto/update-coupon.dto';
import { GetAdminCouponsQueryDto } from '../dto/get-admin-coupons-query.dto';
import { ValidateCouponDto } from '../dto/validate-coupon.dto';
import { assertCouponEligible } from '../coupons.util';

/** How many times to retry CouponsRepository.reserveRedemption after a Postgres serialization
 *  failure (two concurrent redemption attempts genuinely conflicting) before giving up and
 *  surfacing the error — same bounded-retry convention as WalletService.writeLedgerEntry. */
const MAX_SERIALIZATION_RETRIES = 2;

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2034'
  );
}

/**
 * Every rule a coupon must pass before it can be applied — shared by the customer-facing
 * `/coupons/validate` preview endpoint and OrdersService's redemption step at order placement, so
 * the two can never silently disagree about whether a code is currently usable.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly couponsRepository: CouponsRepository,
    private readonly pricingEngineService: PricingEngineService,
  ) {}

  /**
   * Runs every eligibility rule and returns the resolved Coupon entity, or throws. Used by
   * `validate()` below (the customer-facing checkout preview, called freely as the cart changes)
   * and by CheckoutStore's re-validation effect — a read-only preview, not a commitment, so it
   * deliberately does NOT reserve/consume anything here.
   *
   * NOT used for the actual redemption at order placement any more (see Sprint 1.3): this method
   * reads `coupon.totalUsed` and counts existing redemptions with no locking, so two concurrent
   * calls can both observe the same pre-redemption snapshot and both pass — fine for a preview
   * (worst case, a stale "yes you can use this" that gets caught for real at placement), but not
   * safe as the actual gate. OrdersService.placeOrderInternal calls
   * CouponsService.reserveRedemption instead, which re-runs these exact same rules
   * (assertCouponEligible) atomically, inside the transaction that also claims the usage slot.
   */
  async assertUsable(
    userId: string,
    code: string,
    restaurantId: string,
    subtotal: number,
  ): Promise<Coupon> {
    const coupon = await this.couponsRepository.findByCode(
      code.trim().toUpperCase(),
    );

    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const userRedemptions = await this.couponsRepository.countUserRedemptions(
      coupon.id,
      userId,
    );

    assertCouponEligible(
      coupon,
      restaurantId,
      subtotal,
      userRedemptions,
      new Date(),
    );

    return coupon;
  }

  async validate(userId: string, dto: ValidateCouponDto) {
    const coupon = await this.assertUsable(
      userId,
      dto.code,
      dto.restaurantId,
      dto.subtotal,
    );

    const pricing = this.pricingEngineService.calculate(
      [{ totalPrice: dto.subtotal }],
      coupon,
    );

    return { coupon, pricing };
  }

  async getAvailable(restaurantId?: string) {
    return this.couponsRepository.findAvailable(restaurantId);
  }

  /**
   * The atomic redemption gate (Sprint 1.3) — called by OrdersService BEFORE creating the order,
   * so an order is never created with a discount that turns out to be invalid. Re-runs every
   * eligibility rule (assertCouponEligible) and claims one usage slot — plus a placeholder ledger
   * row, so a concurrent reservation by the same user has something real to see — in a single
   * transaction guarded by a conditional update and a Postgres advisory lock (see
   * CouponsRepository.reserveRedemption for exactly how, and why that's deliberately NOT a
   * SERIALIZABLE transaction), so two concurrent requests can never both succeed past a limit
   * that only allows one of them.
   *
   * Retries once or twice (MAX_SERIALIZATION_RETRIES) on the rare Postgres serialization failure
   * this can still produce — same bounded-retry convention as WalletService.writeLedgerEntry. On
   * retry, the re-check reads post-commit data, so it either succeeds for real or correctly
   * rejects with the same eligibility error a non-racing caller would have seen.
   */
  async reserveRedemption(
    userId: string,
    code: string,
    restaurantId: string,
    subtotal: number,
    attempt = 0,
  ): Promise<{ coupon: Coupon; redemptionId: string }> {
    try {
      return await this.couponsRepository.reserveRedemption({
        userId,
        code: code.trim().toUpperCase(),
        restaurantId,
        subtotal,
      });
    } catch (error) {
      if (
        isSerializationFailure(error) &&
        attempt < MAX_SERIALIZATION_RETRIES
      ) {
        return this.reserveRedemption(
          userId,
          code,
          restaurantId,
          subtotal,
          attempt + 1,
        );
      }

      throw error;
    }
  }

  /**
   * Undoes a reserveRedemption() claim that didn't end up producing a real order — e.g. the
   * order-creation attempt it was reserved for lost the idempotency race (Sprint 1.2) to a
   * concurrent identical request, or failed outright. Deletes the placeholder ledger row and
   * releases the usage slot atomically (see CouponsRepository.releaseRedemption) — only ever
   * called once per successful reservation (see OrdersService.placeOrderInternal), so it can't
   * under- or over-release.
   */
  releaseRedemption(couponId: string, redemptionId: string): Promise<void> {
    return this.couponsRepository.releaseRedemption(couponId, redemptionId);
  }

  /**
   * Sprint 1.8 — releases a completed order's coupon usage back to the pool on refund
   * ("Coupon redemption is never released after refund/cancel", a confirmed production-readiness
   * finding). A no-op, not an error, when the order never used a coupon, or when this order's
   * redemption was already released by a concurrent/duplicate refund attempt — the caller
   * (OrdersService.refundOrder) is already gated by its own order-level exactly-once claim before
   * this ever runs, but this stays defensively idempotent on its own terms too rather than
   * depending solely on that caller-side guarantee.
   */
  async releaseForOrder(orderId: string): Promise<void> {
    const redemption =
      await this.couponsRepository.findRedemptionByOrderId(orderId);

    if (!redemption) {
      return;
    }

    try {
      await this.couponsRepository.releaseRedemption(
        redemption.couponId,
        redemption.id,
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2025'
      ) {
        // Already released by a concurrent/duplicate call — idempotent no-op.
        return;
      }

      throw error;
    }
  }

  /**
   * Links the already-reserved ledger row to the real order and sets its final discount amount
   * once the order actually exists — the usage slot itself was already atomically claimed by
   * reserveRedemption(), so this is just bookkeeping (no further eligibility check, no counter
   * increment here).
   */
  async finalizeRedemption(
    redemptionId: string,
    orderId: string,
    discountAmount: number,
  ): Promise<void> {
    await this.couponsRepository.finalizeRedemption(
      redemptionId,
      orderId,
      discountAmount,
    );
  }

  async findByIdOrThrow(id: string): Promise<Coupon> {
    const coupon = await this.couponsRepository.findById(id);

    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    return coupon;
  }

  async create(dto: CreateCouponDto) {
    if (dto.scope === 'RESTAURANT' && !dto.restaurantId) {
      throw new BadRequestException(
        'restaurantId is required when scope is RESTAURANT',
      );
    }

    return this.couponsRepository.create(dto);
  }

  async update(id: string, dto: UpdateCouponDto) {
    await this.findByIdOrThrow(id);

    return this.couponsRepository.update(id, dto);
  }

  async disable(id: string) {
    await this.findByIdOrThrow(id);

    return this.couponsRepository.setActive(id, false);
  }

  async delete(id: string) {
    await this.findByIdOrThrow(id);

    await this.couponsRepository.delete(id);
  }

  async findAllForAdmin(query: GetAdminCouponsQueryDto) {
    const { items, total } =
      await this.couponsRepository.findAllForAdmin(query);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
