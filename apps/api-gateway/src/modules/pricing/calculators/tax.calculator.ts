import { Injectable } from '@nestjs/common';

/** Matches OrdersService's pre-existing hardcoded rate exactly — preserved here, not changed. */
const FLAT_TAX_RATE = 0.05;

/**
 * Today: a flat 5% of subtotal, not itemized by jurisdiction/rate. A future, more granular tax
 * calculation (per-restaurant tax profile, per-item rate) replaces this calculator's internals
 * without changing PricingEngineService's call site.
 */
@Injectable()
export class TaxCalculator {
  calculate(subtotal: number): number {
    return subtotal * FLAT_TAX_RATE;
  }
}
