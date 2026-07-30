import { Injectable } from '@nestjs/common';

/** Matches OrdersService's pre-existing hardcoded fee exactly — preserved here, not changed. */
const FLAT_DELIVERY_FEE = 40;

/**
 * Today: a flat platform-wide fee, regardless of subtotal, restaurant, or distance. Distance-based
 * and surge/dynamic delivery pricing are planned future extensions (see PricingEngineService's
 * doc comment) — they replace this calculator's internals, not its call site.
 */
@Injectable()
export class DeliveryFeeCalculator {
  calculate(): number {
    return FLAT_DELIVERY_FEE;
  }
}
