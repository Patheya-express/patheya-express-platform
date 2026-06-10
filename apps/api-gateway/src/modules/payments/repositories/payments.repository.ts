import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
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
  
    async findByOrderId(
      orderId: string,
    ) {
  
      return this.prisma.payment.findUnique({
  
        where: {
          orderId,
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
  
    async createWebhookEvent(
      data: any,
    ) {
  
      return this.prisma.webhookEvent.create({
        data,
      });
  
    }
  
    async createRefund(
      data: any,
    ) {
  
      return this.prisma.refund.create({
        data,
      });
  
    }
  
  }