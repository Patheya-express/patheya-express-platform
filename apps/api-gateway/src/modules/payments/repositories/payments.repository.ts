import { Injectable } from '@nestjs/common';

import {
  TransactionStatus,
  PaymentProvider,
  PaymentMethod,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export interface AdminPaymentFilterParams {
  search?: string;
  status?: TransactionStatus;
  provider?: PaymentProvider;
  method?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPayment(data: any) {
    return this.prisma.payment.create({
      data,
    });
  }

  async findById(id: string) {
    return this.prisma.payment.findUnique({
      where: {
        id,
      },
    });
  }

  async findByProviderOrderId(providerOrderId: string) {
    return this.prisma.payment.findFirst({
      where: {
        providerOrderId,
      },
    });
  }

  async findLatestAttempt(orderId: string) {
    return this.prisma.payment.findFirst({
      where: {
        orderId,
      },
      orderBy: {
        attemptNumber: 'desc',
      },
    });
  }

  async findActivePaymentForOrder(orderId: string) {
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

  async deactivateOrderAttempts(orderId: string) {
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
    method?: PaymentMethod,
  ) {
    return this.prisma.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status,
        providerPaymentId,
        ...(method ? { method } : {}),
      },
    });
  }

  async createRefund(data: any) {
    return this.prisma.refund.create({
      data,
    });
  }

  async createWebhookEvent(data: any) {
    return this.prisma.webhookEvent.create({
      data,
    });
  }
  async findByProviderPaymentId(providerPaymentId: string) {
    return this.prisma.payment.findFirst({
      where: {
        providerPaymentId,
      },
    });
  }
  async markWebhookProcessed(webhookId: string) {
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
        status: 'PENDING',

        providerOrderId: {
          not: null,
        },
      },

      take: 100,
    });
  }

  private buildAdminWhere(params: AdminPaymentFilterParams): any {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.provider) {
      where.provider = params.provider;
    }

    if (params.method) {
      where.method = params.method;
    }

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),

        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { providerOrderId: { contains: params.search, mode: 'insensitive' } },
        { providerPaymentId: { contains: params.search, mode: 'insensitive' } },
        {
          order: {
            orderNumber: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          order: {
            customer: {
              firstName: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
        {
          order: {
            customer: {
              lastName: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
        {
          order: {
            customer: {
              email: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
        {
          order: {
            customer: {
              phone: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Platform-wide, filterable payment listing for admin use. Joins through to the order and
   * its customer (two hops — Payment has no direct customer FK) plus the payment's own refund
   * history, none of which the create/verify/refund flows need since they already know the
   * payment they're operating on.
   */
  async findAllForAdmin(
    params: AdminPaymentFilterParams & { skip: number; take: number },
  ): Promise<{ items: any[]; total: number }> {
    const where = this.buildAdminWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          order: {
            include: {
              customer: true,
            },
          },

          refunds: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      }),

      this.prisma.payment.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async sumSuccessfulAmountToday(): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      _sum: {
        amount: true,
      },

      where: {
        status: TransactionStatus.SUCCESS,

        createdAt: {
          gte: startOfToday(),
        },
      },
    });

    return Number(result._sum.amount ?? 0);
  }
}
