import { VerifyPaymentDto } from '../dto/verify-payment.dto';

/**
 * The subset of a provider's "order" fields PaymentsService.createPayment actually reads
 * (`.id`) or passes straight through to the client as-is (the rest — see
 * dto/razorpay-order-response.dto.ts, which today documents exactly this shape for Razorpay).
 */
export interface ProviderOrder {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  created_at: number;
}

/**
 * The subset of a provider's "payment" fields PaymentsService reads — from fetchPayment()
 * (assertProviderPaymentMatches, confirmRefundOnProvider) and from fetchOrderPayments()'s
 * `items` (PaymentReconciliationService). `refund_status`/`amount_refunded` are only present on
 * a fetchPayment() result, not on the entries returned by fetchOrderPayments().
 */
export interface ProviderPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status?: string;
  method?: string;
  refund_status?: string;
  amount_refunded?: number;
}

/** fetchOrderPayments()'s result shape — every payment attempt recorded against a provider order. */
export interface ProviderOrderPayments {
  entity: string;
  count: number;
  items: ProviderPayment[];
}

/**
 * The subset of a provider's "refund" fields PaymentsService reads (`.id`) or passes straight
 * through to the client as-is (the rest — see dto/razorpay-refund-response.dto.ts, which today
 * documents exactly this shape for Razorpay).
 */
export interface ProviderRefund {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  status: string;
  created_at: number;
}

/**
 * The payment provider contract PaymentsService and PaymentReconciliationService actually
 * depend on today — every method here is a capability one of those two services calls on
 * RazorpayProvider. Bound to the PAYMENT_PROVIDER DI token (see
 * constants/payment-provider.constants.ts); PaymentsCoreModule resolves it to RazorpayProvider.
 *
 * Deliberately not designed around any future (e.g. UPI) provider — this interface exists to
 * make the *current* Razorpay dependency swappable in principle, not to anticipate what a second
 * provider will need. Extending it for a second implementation is a decision for whenever that
 * provider is actually chosen, not something to guess at here.
 */
export interface PaymentProvider {
  /** Creates a provider-side order for `amount` (rupees) against internal `receipt`, returning
   *  the full order object — `PaymentsService.createPayment` reads `.id` and returns the rest of
   *  it to the client verbatim. */
  createOrder(amount: number, receipt: string): Promise<ProviderOrder>;

  /** Verifies the signature on a client-submitted payment-verification payload (Razorpay's HMAC
   *  over `${order_id}|${payment_id}` today). Synchronous — no network call is involved. */
  verifyPaymentSignature(payload: VerifyPaymentDto): boolean;

  /** Verifies a webhook delivery's signature against its raw request body. Synchronous — no
   *  network call is involved. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;

  /** Refunds `amount` (rupees) of a previously captured payment, returning the resulting refund
   *  object — `PaymentsService.refundPayment` reads `.id` and returns the rest of it to the
   *  client verbatim. */
  refund(providerPaymentId: string, amount: number): Promise<ProviderRefund>;

  /** Fetches a single payment's current state directly from the provider — used to
   *  independently confirm a client-submitted verification (assertProviderPaymentMatches) and to
   *  resolve an ambiguous refund-call failure (confirmRefundOnProvider). */
  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>;

  /** Fetches every payment attempt recorded against a provider order — used by
   *  PaymentReconciliationService to find a captured payment whose webhook never arrived. */
  fetchOrderPayments(providerOrderId: string): Promise<ProviderOrderPayments>;
}
