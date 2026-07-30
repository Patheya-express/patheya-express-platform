/**
 * One line of the human-readable price breakdown a caller (e.g. the customer-facing order
 * summary) can render directly, in order, without knowing which calculators produced it.
 */
export interface PricingBreakdownEntry {
  label: string;
  amount: number;
}

/**
 * The single, reusable shape every pricing calculation returns. Most fields are 0 until their
 * corresponding calculator exists (see PricingEngineService) — a caller can always read every
 * field safely today, and none of them change meaning when a real calculator replaces the 0.
 */
export interface PricingResult {
  subtotal: number;
  deliveryFee: number;
  taxAmount: number;
  discountAmount: number;
  walletAmount: number;
  platformFee: number;
  totalAmount: number;
  pricingBreakdown: PricingBreakdownEntry[];
}
