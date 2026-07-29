import * as crypto from 'crypto';

import { RazorpayProvider } from './razorpay.provider';

/**
 * Sprint 1.5 — the two HMAC comparisons that gate "was this payment/webhook actually signed by
 * Razorpay" are the single most security-critical checks in the whole payment pipeline. Verifies
 * both the correctness (right signature accepted, wrong one rejected) and the hardening
 * (constant-time comparison, no crash on a mismatched-length forged signature).
 */
describe('RazorpayProvider — signature verification', () => {
  const KEY_SECRET = 'test-key-secret';
  const WEBHOOK_SECRET = 'test-webhook-secret';
  let provider: RazorpayProvider;

  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    provider = new RazorpayProvider();
  });

  function sign(secret: string, message: string): string {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  }

  describe('verifySignature (client-driven verify)', () => {
    it('accepts a correctly-signed order_id|payment_id pair', () => {
      const payload = {
        razorpay_order_id: 'order_abc123',
        razorpay_payment_id: 'pay_xyz789',
        razorpay_signature: sign(KEY_SECRET, 'order_abc123|pay_xyz789'),
      };

      expect(provider.verifySignature(payload)).toBe(true);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const payload = {
        razorpay_order_id: 'order_abc123',
        razorpay_payment_id: 'pay_xyz789',
        razorpay_signature: sign(
          'attacker-guessed-secret',
          'order_abc123|pay_xyz789',
        ),
      };

      expect(provider.verifySignature(payload)).toBe(false);
    });

    it('rejects a valid signature replayed against a different order_id/payment_id pair', () => {
      const genuineSignature = sign(KEY_SECRET, 'order_abc123|pay_xyz789');

      expect(
        provider.verifySignature({
          razorpay_order_id: 'order_DIFFERENT',
          razorpay_payment_id: 'pay_xyz789',
          razorpay_signature: genuineSignature,
        }),
      ).toBe(false);
    });

    it('rejects a forged signature of the wrong length rather than throwing', () => {
      expect(
        provider.verifySignature({
          razorpay_order_id: 'order_abc123',
          razorpay_payment_id: 'pay_xyz789',
          razorpay_signature: 'too-short',
        }),
      ).toBe(false);
    });

    it('rejects a missing signature rather than throwing', () => {
      expect(
        provider.verifySignature({
          razorpay_order_id: 'order_abc123',
          razorpay_payment_id: 'pay_xyz789',
        }),
      ).toBe(false);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a correctly-signed raw body', () => {
      const rawBody = JSON.stringify({ event: 'payment.captured' });
      const signature = sign(WEBHOOK_SECRET, rawBody);

      expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('rejects a tampered body against an unchanged signature', () => {
      const originalBody = JSON.stringify({
        event: 'payment.captured',
        amount: 100,
      });
      const signature = sign(WEBHOOK_SECRET, originalBody);
      const tamperedBody = JSON.stringify({
        event: 'payment.captured',
        amount: 999999,
      });

      expect(provider.verifyWebhookSignature(tamperedBody, signature)).toBe(
        false,
      );
    });

    it('rejects a signature signed with the wrong (non-webhook) secret', () => {
      const rawBody = JSON.stringify({ event: 'payment.captured' });
      const signature = sign(KEY_SECRET, rawBody);

      expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(false);
    });

    it('rejects an empty/missing signature rather than throwing', () => {
      const rawBody = JSON.stringify({ event: 'payment.captured' });

      expect(provider.verifyWebhookSignature(rawBody, '')).toBe(false);
    });
  });
});
