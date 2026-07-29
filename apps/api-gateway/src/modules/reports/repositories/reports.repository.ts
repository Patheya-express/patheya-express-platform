import { Injectable } from '@nestjs/common';

import { OrderStatus, PaymentMode } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export interface ReportDateRange {
  dateFrom?: Date;
  dateTo?: Date;
}

export interface ReportOrderFilters extends ReportDateRange {
  branchId?: string;
  status?: OrderStatus;
}

export interface ReportPaymentFilters extends ReportDateRange {
  branchId?: string;
  paymentMode?: PaymentMode;
}

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The single order query every order-based report (Daily Sales, Orders, Revenue, Tax Summary,
   *  Cancelled Orders) builds on — each report just applies its own filter/grouping on top. */
  async findOrders(restaurantId: string, filters: ReportOrderFilters) {
    return this.prisma.order.findMany({
      where: {
        restaurantId,
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.dateFrom || filters.dateTo
          ? {
              placedAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { placedAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        deliveredAt: true,
        status: true,
        paymentMode: true,
        paymentStatus: true,
        branchId: true,
        subtotalAmount: true,
        deliveryFee: true,
        taxAmount: true,
        discountAmount: true,
        totalAmount: true,
      },
    });
  }

  /** Payment Summary — Payment has no restaurantId of its own, so restaurant/branch scoping goes
   *  through its owning Order. */
  async findPayments(restaurantId: string, filters: ReportPaymentFilters) {
    return this.prisma.payment.findMany({
      where: {
        order: {
          restaurantId,
          ...(filters.branchId ? { branchId: filters.branchId } : {}),
          ...(filters.paymentMode ? { paymentMode: filters.paymentMode } : {}),
        },
        ...(filters.dateFrom || filters.dateTo
          ? {
              createdAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        method: true,
        amount: true,
        status: true,
        createdAt: true,
        order: { select: { orderNumber: true } },
      },
    });
  }

  /** Refund Summary — Refund scopes through Payment -> Order the same way Payment scopes through Order. */
  async findRefunds(
    restaurantId: string,
    filters: ReportDateRange & { branchId?: string },
  ) {
    return this.prisma.refund.findMany({
      where: {
        payment: {
          order: {
            restaurantId,
            ...(filters.branchId ? { branchId: filters.branchId } : {}),
          },
        },
        ...(filters.dateFrom || filters.dateTo
          ? {
              createdAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        createdAt: true,
        payment: {
          select: { orderId: true, order: { select: { orderNumber: true } } },
        },
      },
    });
  }
}
