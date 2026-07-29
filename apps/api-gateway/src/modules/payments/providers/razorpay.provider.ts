import { Injectable } from '@nestjs/common';

import Razorpay from 'razorpay';

import * as crypto from 'crypto';

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

  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,

      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }

  async createOrder(amount: number, receipt: string) {
    return this.razorpay.orders.create({
      amount: amount * 100,

      currency: 'INR',

      receipt,
    });
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
    return this.razorpay.payments.refund(
      paymentId,

      {
        amount: amount * 100,
      },
    );
  }
  async fetchPayment(providerPaymentId: string) {
    return this.razorpay.payments.fetch(providerPaymentId);
  }
  async fetchOrderPayments(providerOrderId: string) {
    return this.razorpay.orders.fetchPayments(providerOrderId);
  }
}
