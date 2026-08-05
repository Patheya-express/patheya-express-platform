import { Injectable, Optional } from '@nestjs/common';

import Razorpay from 'razorpay';

import * as crypto from 'crypto';

import { MetricsService } from '../../metrics/metrics.service';

/**
 * Constant-time signature comparison — a plain `===` leaks timing information proportional to
 * how many leading bytes match, which is a textbook (if hard-to-exploit-remotely) side channel
 * for guessing a valid signature byte-by-byte. `crypto.timingSafeEqual` throws if the two
 * buffers differ in length, so that's checked first — an attacker-supplied signature of the
 * wrong length is simply invalid, not a crash.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

@Injectable()
export class RazorpayProvider {
  private readonly razorpay: Razorpay;

  constructor(
    // Optional so razorpay.provider.spec.ts's `new RazorpayProvider()` (no args) keeps working.
    @Optional()
    private readonly metrics?: MetricsService,
  ) {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,

      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }

  /**
   * Production Readiness Stage D (Observability): times and counts failures for the real
   * Razorpay SDK call itself — distinct from patheya_payment_latency_seconds (a business-flow
   * duration from Payment.createdAt to the success/failure event, which also includes DB writes
   * and webhook round-trip time from the customer's device). This is what lets "Razorpay is
   * slow/erroring" be distinguished from "our own verification/reconciliation logic has a bug."
   */
  private async timedCall<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();

    try {
      const result = await fn();

      this.metrics?.observeRazorpayApiCall(
        operation,
        (Date.now() - start) / 1000,
      );

      return result;
    } catch (error) {
      this.metrics?.observeRazorpayApiCall(
        operation,
        (Date.now() - start) / 1000,
      );
      this.metrics?.recordRazorpayApiCallFailure(operation);

      throw error;
    }
  }

  async createOrder(amount: number, receipt: string) {
    return this.timedCall('createOrder', () =>
      this.razorpay.orders.create({
        amount: amount * 100,

        currency: 'INR',

        receipt,
      }),
    );
  }

  verifySignature(payload: any): boolean {
    const generatedSignature = crypto
      .createHmac(
        'sha256',

        process.env.RAZORPAY_KEY_SECRET!,
      )

      .update(`${payload.razorpay_order_id}|${payload.razorpay_payment_id}`)

      .digest('hex');

    return timingSafeEqualStrings(
      generatedSignature,
      payload.razorpay_signature ?? '',
    );
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const generatedSignature = crypto
      .createHmac(
        'sha256',

        process.env.RAZORPAY_WEBHOOK_SECRET!,
      )

      .update(payload)

      .digest('hex');

    return timingSafeEqualStrings(generatedSignature, signature ?? '');
  }

  async refund(paymentId: string, amount: number) {
    return this.timedCall('refund', () =>
      this.razorpay.payments.refund(paymentId, {
        amount: amount * 100,
      }),
    );
  }
  async fetchPayment(providerPaymentId: string) {
    return this.timedCall('fetchPayment', () =>
      this.razorpay.payments.fetch(providerPaymentId),
    );
  }
  async fetchOrderPayments(providerOrderId: string) {
    return this.timedCall('fetchOrderPayments', () =>
      this.razorpay.orders.fetchPayments(providerOrderId),
    );
  }
}
