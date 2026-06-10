import {
  Injectable,
} from '@nestjs/common';

import {
  PrismaService,
} from '../../../infrastructure/database/prisma.service';

@Injectable()
export class PaymentsRepository {

  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  async createPayment(
    data: any,
  ) {
    return this.prisma.payment.create({
      data,
    });
  }

  async findById(
    id: string,
  ) {
    return this.prisma.payment.findUnique({
      where: {
        id,
      },
    });
  }

  async findByProviderOrderId(
    providerOrderId: string,
  ) {
    return this.prisma.payment.findFirst({
      where: {
        providerOrderId,
      },
    });
  }

  async findLatestAttempt(
    orderId: string,
  ) {
    return this.prisma.payment.findFirst({
      where: {
        orderId,
      },
      orderBy: {
        attemptNumber: 'desc',
      },
    });
  }

  async findActivePaymentForOrder(
    orderId: string,
  ) {
    return this.prisma.payment.findFirst({
      where: {
        orderId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deactivateOrderAttempts(
    orderId: string,
  ) {
    return this.prisma.payment.updateMany({
      where: {
        orderId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  }

  async updatePaymentStatus(
    paymentId: string,
    status: any,
    providerPaymentId?: string,
  ) {
    return this.prisma.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status,
        providerPaymentId,
      },
    });
  }

  async createRefund(
    data: any,
  ) {
    return this.prisma.refund.create({
      data,
    });
  }

  async createWebhookEvent(
    data: any,
  ) {
    return this.prisma.webhookEvent.create({
      data,
    });
  }
  async findByProviderPaymentId(
    providerPaymentId: string,
  ) {
  
    return this.prisma.payment.findFirst({
  
      where: {
        providerPaymentId,
      },
  
    });
  
  }
  async markWebhookProcessed(
    webhookId: string,
  ) {
  
    return this.prisma.webhookEvent.update({
  
      where: {
        id: webhookId,
      },
  
      data: {
        processed: true,
      },
  
    });
  
  }
  async findPendingPayments() {

    return this.prisma.payment.findMany({
  
      where: {
  
        status:
          'PENDING',
  
        providerOrderId: {
          not: null,
        },
  
      },
  
      take: 100,
  
    });
  
  }
}