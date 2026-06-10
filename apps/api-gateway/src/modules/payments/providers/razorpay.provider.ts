import {
    Injectable,
  } from '@nestjs/common';
  
  import Razorpay
  from 'razorpay';
  
  import * as crypto
  from 'crypto';
  
  @Injectable()
  export class RazorpayProvider {
  
    private readonly razorpay:
      Razorpay;
  
    constructor() {
  
      this.razorpay =
        new Razorpay({
  
          key_id:
            process.env
              .RAZORPAY_KEY_ID!,
  
          key_secret:
            process.env
              .RAZORPAY_KEY_SECRET!,
  
        });
  
    }
  
    async createOrder(
  
      amount: number,
  
      receipt: string,
  
    ) {
  
      return this.razorpay
        .orders.create({
  
          amount:
            amount * 100,
  
          currency:
            'INR',
  
          receipt,
  
        });
  
    }
  
    async verifySignature(
      payload: any,
    ) {
  
      const generatedSignature =
  
        crypto
          .createHmac(
  
            'sha256',
  
            process.env
              .RAZORPAY_KEY_SECRET!,
  
          )
  
          .update(
  
            `${payload.razorpay_order_id}|${payload.razorpay_payment_id}`,
  
          )
  
          .digest('hex');
  
      return (
  
        generatedSignature ===
  
        payload.razorpay_signature
  
      );
  
    }
  
    async refund(
  
      paymentId: string,
  
      amount: number,
  
    ) {
  
      return this.razorpay
        .payments.refund(
  
          paymentId,
  
          {
  
            amount:
              amount * 100,
  
          },
  
        );
  
    }
  
  }