import { Injectable, Optional } from '@nestjs/common';

import Razorpay from 'razorpay';

import * as crypto from 'crypto';

import { MetricsService } from '../../metrics/metrics.service';

import { VerifyPaymentDto } from '../dto/verify-payment.dto';

import type {
  PaymentProvider,
  ProviderOrder,
  ProviderOrderPayments,
  ProviderPayment,
  ProviderRefund,
} from './payment-provider.interface';

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
export class RazorpayProvider implements PaymentProvider {
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

  async createOrder(amount: number, receipt: string): Promise<ProviderOrder> {
    const order = await this.timedCall('createOrder', () =>
      this.razorpay.orders.create({
        amount: amount * 100,

        currency: 'INR',

        receipt,
      }),
    );

    // Razorpay's SDK types `amount` as `number | string` on the request body and carries a few
    // fields (description, token, ...) this interface doesn't need — the object returned at
    // runtime is Razorpay's real order response either way, so this is a type-shape adapter, not
    // a behavior change.
    return order as unknown as ProviderOrder;
  }

  verifyPaymentSignature(payload: VerifyPaymentDto): boolean {
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

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const generatedSignature = crypto
      .createHmac(
        'sha256',

        process.env.RAZORPAY_WEBHOOK_SECRET!,
      )

      .update(rawBody)

      .digest('hex');

    return timingSafeEqualStrings(generatedSignature, signature ?? '');
  }

  async refund(
    providerPaymentId: string,
    amount: number,
  ): Promise<ProviderRefund> {
    const refund = await this.timedCall('refund', () =>
      this.razorpay.payments.refund(providerPaymentId, {
        amount: amount * 100,
      }),
    );

    return refund as unknown as ProviderRefund;
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const payment = await this.timedCall('fetchPayment', () =>
      this.razorpay.payments.fetch(providerPaymentId),
    );

    return payment as unknown as ProviderPayment;
  }

  async fetchOrderPayments(
    providerOrderId: string,
  ): Promise<ProviderOrderPayments> {
    const payments = await this.timedCall('fetchOrderPayments', () =>
      this.razorpay.orders.fetchPayments(providerOrderId),
    );

    return payments as unknown as ProviderOrderPayments;
  }
}
