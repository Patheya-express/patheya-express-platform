import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import {
  TransactionStatus,
  PaymentProvider as ProviderType,
  PaymentMethod,
} from '@prisma/client';

import { PaymentsRepository } from '../repositories/payments.repository';

import { RazorpayProvider } from '../providers/razorpay.provider';

import { EventBusService } from '../../../core/events/event-bus.service';

import { QueueService } from '../../../infrastructure/queues/queue.service';
import { PAYMENT_EVENTS } from '../events/payment-events.constants';
import { PaymentStatusValidator } from '../Validators/payment-status.validator';
import { GetAdminPaymentsQueryDto } from '../dto/get-admin-payments-query.dto';
import { PaginatedAdminPaymentsResponseDto } from '../dto/paginated-admin-payments-response.dto';
import { AdminPaymentResponseDto } from '../dto/admin-payment-response.dto';

/** Razorpay's captured-payment webhook entity uses lowercase method names — map onto our enum. */
const RAZORPAY_METHOD_MAP: Record<string, string> = {
  upi: 'UPI',
  card: 'CARD',
  netbanking: 'NETBANKING',
  wallet: 'WALLET',
};

/**
 * Flattens the raw Prisma include shape (order.customer as a full User row) into the documented
 * AdminPaymentResponseDto shape — this is what keeps the customer's passwordHash out of admin
 * API responses.
 */
function toAdminPayment(payment: any): AdminPaymentResponseDto {
  return {
    id: payment.id,
    orderId: payment.orderId,
    order: {
      id: payment.order.id,
      orderNumber: payment.order.orderNumber,
      status: payment.order.status,
    },
    customer: {
      id: payment.order.customer.id,
      firstName: payment.order.customer.firstName,
      lastName: payment.order.customer.lastName,
      email: payment.order.customer.email,
      phone: payment.order.customer.phone,
    },
    amount: Number(payment.amount),
    provider: payment.provider,
    method: payment.method ?? undefined,
    status: payment.status,
    providerOrderId: payment.providerOrderId ?? undefined,
    providerPaymentId: payment.providerPaymentId ?? undefined,
    refunds: payment.refunds.map((refund: any) => ({
      id: refund.id,
      amount: Number(refund.amount),
      reason: refund.reason ?? undefined,
      status: refund.status,
      createdAt: refund.createdAt,
    })),
    attemptNumber: payment.attemptNumber,
    isActive: payment.isActive,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,

    private readonly razorpayProvider: RazorpayProvider,

    private readonly eventBus: EventBusService,

    private readonly queueService: QueueService,
  ) {}

  async createPayment(orderId: string, amount: number) {
    const activePayment =
      await this.paymentsRepository.findActivePaymentForOrder(orderId);

    if (activePayment && activePayment.status === TransactionStatus.SUCCESS) {
      throw new ConflictException('Order already paid');
    }

    const latestAttempt =
      await this.paymentsRepository.findLatestAttempt(orderId);

    const attemptNumber = latestAttempt ? latestAttempt.attemptNumber + 1 : 1;

    await this.paymentsRepository.deactivateOrderAttempts(orderId);

    const receipt = `order_${orderId}_attempt_${attemptNumber}`;

    const providerOrder = await this.razorpayProvider.createOrder(
      amount,
      receipt,
    );

    const payment = await this.paymentsRepository.createPayment({
      orderId,

      provider: ProviderType.RAZORPAY,

      amount,

      providerOrderId: providerOrder.id,

      attemptNumber,

      isActive: true,
    });

    return {
      payment,

      providerOrder,
    };
  }

  async verifyPayment(payload: any) {
    const isValid = await this.razorpayProvider.verifySignature(payload);

    if (!isValid) {
      throw new ConflictException('Invalid payment signature');
    }

    const payment = await this.paymentsRepository.findByProviderOrderId(
      payload.razorpay_order_id,
    );

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === TransactionStatus.SUCCESS) {
      return payment;
    }

    await this.paymentsRepository.deactivateOrderAttempts(payment.orderId);

    const updatedPayment = await this.transitionPaymentStatus(
      payment.id,

      TransactionStatus.SUCCESS,

      payload.razorpay_payment_id,
    );

    await this.eventBus.publish(
      'payment.success',

      {
        paymentId: payment.id,

        orderId: payment.orderId,
      },
    );

    await this.queueService.addNotificationJob({
      type: 'payment-success',

      orderId: payment.orderId,
    });

    return updatedPayment;
  }
  private async handlePaymentCaptured(payload: any) {
    const entity = payload.payload.payment.entity;

    const payment = await this.paymentsRepository.findByProviderOrderId(
      entity.order_id,
    );

    if (!payment) {
      return;
    }

    if (payment.status === TransactionStatus.SUCCESS) {
      return;
    }

    const updatedPayment = await this.transitionPaymentStatus(
      payment.id,

      TransactionStatus.SUCCESS,

      entity.id,

      RAZORPAY_METHOD_MAP[entity.method] as PaymentMethod | undefined,
    );

    await this.eventBus.publish(
      'payment.success',

      {
        paymentId: payment.id,

        orderId: payment.orderId,
      },
    );

    await this.queueService.addNotificationJob({
      type: 'payment-success',

      orderId: payment.orderId,
    });

    return updatedPayment;
  }
  private async handlePaymentFailed(payload: any) {
    const entity = payload.payload.payment.entity;

    const payment = await this.paymentsRepository.findByProviderOrderId(
      entity.order_id,
    );

    if (!payment) {
      return;
    }

    if (payment.status === TransactionStatus.FAILED) {
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

    nextStatus: TransactionStatus,

    providerPaymentId?: string,

    method?: PaymentMethod,
  ) {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    PaymentStatusValidator.validateTransition(
      payment.status,

      nextStatus,
    );

    return this.paymentsRepository.updatePaymentStatus(
      payment.id,

      nextStatus,

      providerPaymentId,

      method,
    );
  }

  async refundPayment(paymentId: string, amount: number, reason?: string) {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== TransactionStatus.SUCCESS) {
      throw new ConflictException('Only successful payments can be refunded');
    }

    const refund = await this.razorpayProvider.refund(
      payment.providerPaymentId!,
      amount,
    );
    await this.transitionPaymentStatus(
      payment.id,

      TransactionStatus.REFUNDED,
    );

    await this.paymentsRepository.createRefund({
      paymentId,

      amount,

      reason,

      status: TransactionStatus.REFUNDED,
    });

    return refund;
  }

  async processWebhook(payload: any) {
    switch (payload.event) {
      case PAYMENT_EVENTS.CAPTURED:
        await this.handlePaymentCaptured(payload);

        break;

      case PAYMENT_EVENTS.FAILED:
        await this.handlePaymentFailed(payload);

        break;
    }

    await this.paymentsRepository.createWebhookEvent({
      provider: 'RAZORPAY',

      eventType: payload.event,

      payload,

      processed: true,
    });

    return {
      success: true,
    };
  }

  async getGrossRevenueToday(): Promise<number> {
    return this.paymentsRepository.sumSuccessfulAmountToday();
  }

  async findActivePaymentForOrder(orderId: string) {
    return this.paymentsRepository.findActivePaymentForOrder(orderId);
  }

  async getAllForAdmin(query: GetAdminPaymentsQueryDto): Promise<PaginatedAdminPaymentsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.paymentsRepository.findAllForAdmin({
      search: query.search,
      status: query.status,
      provider: query.provider,
      method: query.method,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      skip,
      take: query.limit,
    });

    return {
      items: items.map(toAdminPayment),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }
}
