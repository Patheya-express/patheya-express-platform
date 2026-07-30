import { Injectable } from '@nestjs/common';

/**
 * The only shape SubtotalCalculator needs from an order line — deliberately narrower than the
 * full Prisma order-item-create payload, so callers don't have to construct one just to price it.
 */
export interface PricableOrderItem {
  totalPrice: number;
}

/**
 * Sums already-resolved line-item totals (unit price + addons, times quantity — resolved by the
 * caller, e.g. OrdersService, which owns menu/variant/addon lookup and validation). This
 * calculator only sums; it has no opinion on how a single item's price was derived.
 */
@Injectable()
export class SubtotalCalculator {
  calculate(items: PricableOrderItem[]): number {
    return items.reduce((sum, item) => sum + item.totalPrice, 0);
  }
}
