import {
    Injectable,
    ConflictException,
    NotFoundException,
  } from '@nestjs/common';
  
  import {
    TransactionStatus,
    PaymentProvider as ProviderType,
  } from '@prisma/client';
  
  import { PaymentsRepository }
  from '../repositories/payments.repository';
  
  import { RazorpayProvider }
  from '../providers/razorpay.provider';
  
  import { EventBusService }
  from '../../../core/events/event-bus.service';
  
  import { QueueService }
  from '../../../infrastructure/queues/queue.service';
  
  @Injectable()
  export class PaymentsService {
  
    constructor(
  
      private readonly paymentsRepository:
        PaymentsRepository,
  
      private readonly razorpayProvider:
        RazorpayProvider,
  
      private readonly eventBus:
        EventBusService,
  
      private readonly queueService:
        QueueService,
  
    ) {}
  
    async createPayment(
  
      orderId: string,
  
      amount: number,
  
    ) {
  
      const existingPayment =
  
        await this.paymentsRepository
          .findByOrderId(
            orderId,
          );
  
      if (existingPayment) {
  
        throw new ConflictException(
          'Payment already exists',
        );
  
      }
  
      const receipt =
  
        `order_${orderId}`;
  
      const providerOrder =
  
        await this.razorpayProvider
          .createOrder(
  
            amount,
  
            receipt,
  
          );
  
      const payment =
  
        await this.paymentsRepository
          .createPayment({
  
            orderId,
  
            provider:
              ProviderType.RAZORPAY,
  
            amount,
  
            providerOrderId:
              receipt,
  
          });
  
      return {
  
        payment,
  
        providerOrder,
  
      };
  
    }
  
    async verifyPayment(
      payload: any,
    ) {
  
      const isValid =
  
        await this.razorpayProvider
          .verifySignature(
            payload,
          );
  
      if (!isValid) {
  
        throw new ConflictException(
          'Invalid payment signature',
        );
  
      }
  
      const payment =
  
        await this.paymentsRepository
          .findByProviderOrderId(
  
            payload.razorpay_order_id,
  
          );
  
      if (!payment) {
  
        throw new NotFoundException(
          'Payment not found',
        );
  
      }
  
      const updatedPayment =
  
        await this.paymentsRepository
          .updatePaymentStatus(
  
            payment.id,
  
            TransactionStatus.SUCCESS,
  
            payload.razorpay_payment_id,
  
          );
  
      await this.eventBus.publish(
  
        'payment.success',
  
        {
  
          paymentId:
            payment.id,
  
          orderId:
            payment.orderId,
  
        },
  
      );
  
      await this.queueService
        .addNotificationJob({
  
          type:
            'payment-success',
  
          orderId:
            payment.orderId,
  
        });
  
      return updatedPayment;
  
    }
  
    async refundPayment(
  
      paymentId: string,
  
      amount: number,
  
      reason?: string,
  
    ) {
  
      const refund =
  
        await this.razorpayProvider
          .refund(
  
            paymentId,
  
            amount,
  
          );
  
      await this.paymentsRepository
        .createRefund({
  
          paymentId,
  
          amount,
  
          reason,
  
          status:
            TransactionStatus.REFUNDED,
  
        });
  
      return refund;
  
    }
  
    async processWebhook(
      payload: any,
    ) {
  
      await this.paymentsRepository
        .createWebhookEvent({
  
          provider:
            'RAZORPAY',
  
          eventType:
            payload.event,
  
          payload,
  
        });
  
      return {
        success: true,
      };
  
    }
  
  }