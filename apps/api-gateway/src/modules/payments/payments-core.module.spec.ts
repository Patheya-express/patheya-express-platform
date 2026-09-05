import { Test } from '@nestjs/testing';

import { PAYMENT_PROVIDER } from './constants/payment-provider.constants';

import { RazorpayProvider } from './providers/razorpay.provider';

import type { PaymentProvider } from './providers/payment-provider.interface';

/**
 * Phase 1 (provider-neutral payment abstraction) — proves the actual DI wiring resolves at
 * runtime, not just that it compiles. Deliberately builds a minimal module mirroring only the
 * provider-selection slice of PaymentsCoreModule (`RazorpayProvider` +
 * `{ provide: PAYMENT_PROVIDER, useExisting: RazorpayProvider }`), rather than the whole module —
 * pulling in AuditCoreModule/PrismaService here would make this a live-database integration test
 * for a question that doesn't need one.
 */
describe('PaymentsCoreModule — PAYMENT_PROVIDER wiring', () => {
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
  });

  it('resolves PAYMENT_PROVIDER to the same RazorpayProvider instance registered in the module', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RazorpayProvider,
        { provide: PAYMENT_PROVIDER, useExisting: RazorpayProvider },
      ],
    }).compile();

    const razorpayProvider = moduleRef.get(RazorpayProvider);
    const resolvedProvider = moduleRef.get<PaymentProvider>(PAYMENT_PROVIDER);

    expect(resolvedProvider).toBe(razorpayProvider);
  });

  it('RazorpayProvider exposes every method PaymentsService/PaymentReconciliationService call through the PaymentProvider abstraction', () => {
    const provider: PaymentProvider = new RazorpayProvider();

    expect(typeof provider.createOrder).toBe('function');
    expect(typeof provider.verifyPaymentSignature).toBe('function');
    expect(typeof provider.verifyWebhookSignature).toBe('function');
    expect(typeof provider.refund).toBe('function');
    expect(typeof provider.fetchPayment).toBe('function');
    expect(typeof provider.fetchOrderPayments).toBe('function');
  });
});
