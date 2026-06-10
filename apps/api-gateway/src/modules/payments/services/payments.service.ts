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
  import {
    PAYMENT_EVENTS,
  } from '../events/payment-events.constants';
  import {
    PaymentStatusValidator,
  } from '../Validators/payment-status.validator';
  
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
    
      const activePayment =
    
        await this.paymentsRepository
          .findActivePaymentForOrder(
            orderId,
          );
    
      if (
        activePayment &&
        activePayment.status ===
          TransactionStatus.SUCCESS
      ) {
    
        throw new ConflictException(
          'Order already paid',
        );
    
      }
    
      const latestAttempt =
    
        await this.paymentsRepository
          .findLatestAttempt(
            orderId,
          );
    
      const attemptNumber =
    
        latestAttempt
          ? latestAttempt.attemptNumber + 1
          : 1;
    
      await this.paymentsRepository
        .deactivateOrderAttempts(
          orderId,
        );
    
      const receipt =
        `order_${orderId}_attempt_${attemptNumber}`;
    
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
              providerOrder.id,
    
            attemptNumber,
    
            isActive: true,
    
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
    
      if (
        payment.status ===
        TransactionStatus.SUCCESS
      ) {
    
        return payment;
    
      }
    
      await this.paymentsRepository
        .deactivateOrderAttempts(
          payment.orderId,
        );
    
      const updatedPayment =
    
      await this.transitionPaymentStatus(

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
    private async handlePaymentCaptured(
      payload: any,
    ) {
    
      const entity =
    
        payload.payload
          .payment
          .entity;
    
      const payment =
    
        await this.paymentsRepository
          .findByProviderOrderId(
            entity.order_id,
          );
    
      if (!payment) {
        return;
      }
    
      if (
        payment.status ===
        TransactionStatus.SUCCESS
      ) {
        return;
      }
    
      const updatedPayment =
    
      await this.transitionPaymentStatus(

        payment.id,
      
        TransactionStatus.SUCCESS,
      
        entity.id,
      
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
    private async handlePaymentFailed(
      payload: any,
    ) {
    
      const entity =
    
        payload.payload
          .payment
          .entity;
    
      const payment =
    
        await this.paymentsRepository
          .findByProviderOrderId(
            entity.order_id,
          );
    
      if (!payment) {
        return;
      }
    
      if (
        payment.status ===
        TransactionStatus.FAILED
      ) {
        return;
      }
    
      await this.transitionPaymentStatus(

        payment.id,
      
        TransactionStatus.FAILED,
      
        entity.id,
      
      );
    
    }
    private async transitionPaymentStatus(

      paymentId: string,
    
      nextStatus:
        TransactionStatus,
    
      providerPaymentId?: string,
    
    ) {
    
      const payment =
    
        await this.paymentsRepository
          .findById(
            paymentId,
          );
    
      if (!payment) {
    
        throw new NotFoundException(
          'Payment not found',
        );
    
      }
    
      PaymentStatusValidator
        .validateTransition(
    
          payment.status,
    
          nextStatus,
    
        );
    
      return this.paymentsRepository
        .updatePaymentStatus(
    
          payment.id,
    
          nextStatus,
    
          providerPaymentId,
    
        );
    
    }
  
    async refundPayment(
      paymentId: string,
      amount: number,
      reason?: string,
    ) {
    
      const payment =
    
        await this.paymentsRepository
          .findById(
            paymentId,
          );
    
      if (!payment) {
    
        throw new NotFoundException(
          'Payment not found',
        );
    
      }
    
      if (
        payment.status !==
        TransactionStatus.SUCCESS
      ) {
    
        throw new ConflictException(
          'Only successful payments can be refunded',
        );
    
      }
    
      const refund =
    
        await this.razorpayProvider
          .refund(
            payment.providerPaymentId!,
            amount,
          );
          await this.transitionPaymentStatus(

            payment.id,
          
            TransactionStatus.REFUNDED,
          
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
    
      switch (
        payload.event
      ) {
    
        case PAYMENT_EVENTS.CAPTURED:
    
          await this
            .handlePaymentCaptured(
              payload,
            );
    
          break;
    
        case PAYMENT_EVENTS.FAILED:
    
          await this
            .handlePaymentFailed(
              payload,
            );
    
          break;
    
      }
    
      await this.paymentsRepository
        .createWebhookEvent({
    
          provider:
            'RAZORPAY',
    
          eventType:
            payload.event,
    
          payload,
    
          processed: true,
    
        });
    
      return {
        success: true,
      };
    
    }
  
  }