import { ForbiddenException, Injectable } from '@nestjs/common';

import { OrderStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

import { ReportsRepository } from '../repositories/reports.repository';
import { GetReportQueryDto, ReportFormat } from '../dto/get-report-query.dto';
import { toCsv } from '../exporters/csv-exporter';
import { toExcel } from '../exporters/excel-exporter';
import { toPdf } from '../exporters/pdf-exporter';
import { ReportTable } from '../exporters/report-table.type';

/** Restaurant-scoped roles allowed to view/export reports — mirrors OFFER_MANAGE_ROLES/
 *  REVIEW_MANAGE_ROLES. Reports surface revenue/tax data, at least as sensitive as those, so the
 *  same management-level-only bar applies rather than the looser "any staff" access check
 *  OrdersService.getRestaurantDashboard uses. 'ADMIN' resolves to both platform ADMIN and
 *  SUPER_ADMIN via hasRestaurantRole/getRestaurantRole. */
const REPORT_MANAGE_ROLES = [
  'OWNER',
  'CO_OWNER',
  'BRANCH_MANAGER',
  'ADMIN',
] as const;

const DEFAULT_WINDOW_DAYS = 30;

export interface ExportedFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function resolveRange(
  query: GetReportQueryDto,
  defaultDays = DEFAULT_WINDOW_DAYS,
): { dateFrom: Date; dateTo: Date } {
  const dateTo = query.dateTo
    ? endOfDay(new Date(query.dateTo))
    : endOfDay(new Date());
  const dateFrom = query.dateFrom
    ? startOfDay(new Date(query.dateFrom))
    : startOfDay(
        new Date(dateTo.getTime() - defaultDays * 24 * 60 * 60 * 1000),
      );

  return { dateFrom, dateTo };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getDailySalesReport(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const day = query.dateFrom ? new Date(query.dateFrom) : new Date();
    const orders = await this.reportsRepository.findOrders(restaurantId, {
      branchId: query.branchId,
      dateFrom: startOfDay(day),
      dateTo: endOfDay(day),
    });

    const delivered = orders.filter(
      (order) => order.status === OrderStatus.DELIVERED,
    );
    const cancelled = orders.filter(
      (order) => order.status === OrderStatus.CANCELLED,
    );
    const totalRevenue = delivered.reduce(
      (sum, order) => sum + toNumber(order.totalAmount),
      0,
    );

    return {
      title: `Daily Sales Report — ${dayKey(day)}`,
      generatedAt: new Date(),
      columns: [
        { key: 'orderNumber', label: 'Order #' },
        { key: 'placedAt', label: 'Placed At' },
        { key: 'status', label: 'Status' },
        { key: 'paymentMode', label: 'Payment Mode' },
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'deliveryFee', label: 'Delivery Fee' },
        { key: 'tax', label: 'Tax' },
        { key: 'discount', label: 'Discount' },
        { key: 'total', label: 'Total' },
      ],
      rows: orders.map((order) => ({
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toLocaleString(),
        status: order.status,
        paymentMode: order.paymentMode,
        subtotal: toNumber(order.subtotalAmount),
        deliveryFee: toNumber(order.deliveryFee),
        tax: toNumber(order.taxAmount),
        discount: toNumber(order.discountAmount),
        total: toNumber(order.totalAmount),
      })),
      summary: [
        { label: 'Total Orders', value: orders.length },
        { label: 'Delivered', value: delivered.length },
        { label: 'Cancelled', value: cancelled.length },
        { label: 'Total Revenue (Delivered)', value: totalRevenue.toFixed(2) },
        {
          label: 'Average Order Value (Delivered)',
          value:
            delivered.length > 0
              ? (totalRevenue / delivered.length).toFixed(2)
              : '0.00',
        },
      ],
    };
  }

  async getOrdersReport(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const { dateFrom, dateTo } = resolveRange(query);
    const orders = await this.reportsRepository.findOrders(restaurantId, {
      branchId: query.branchId,
      status: query.status,
      dateFrom,
      dateTo,
    });

    return {
      title: 'Orders Report',
      generatedAt: new Date(),
      columns: [
        { key: 'orderNumber', label: 'Order #' },
        { key: 'placedAt', label: 'Placed At' },
        { key: 'deliveredAt', label: 'Delivered At' },
        { key: 'status', label: 'Status' },
        { key: 'paymentMode', label: 'Payment Mode' },
        { key: 'paymentStatus', label: 'Payment Status' },
        { key: 'total', label: 'Total' },
      ],
      rows: orders.map((order) => ({
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toLocaleString(),
        deliveredAt: order.deliveredAt
          ? order.deliveredAt.toLocaleString()
          : '',
        status: order.status,
        paymentMode: order.paymentMode,
        paymentStatus: order.paymentStatus,
        total: toNumber(order.totalAmount),
      })),
      summary: [
        {
          label: 'Date Range',
          value: `${dayKey(dateFrom)} to ${dayKey(dateTo)}`,
        },
        { label: 'Total Orders', value: orders.length },
      ],
    };
  }

  async getRevenueReport(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const { dateFrom, dateTo } = resolveRange(query);
    const orders = await this.reportsRepository.findOrders(restaurantId, {
      branchId: query.branchId,
      status: OrderStatus.DELIVERED,
      dateFrom,
      dateTo,
    });

    const byDay = new Map<string, typeof orders>();
    for (const order of orders) {
      const key = dayKey(order.placedAt);
      const list = byDay.get(key) ?? [];
      list.push(order);
      byDay.set(key, list);
    }

    const rows = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, dayOrders]) => ({
        date,
        orders: dayOrders.length,
        subtotal: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.subtotalAmount),
          0,
        ),
        deliveryFee: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.deliveryFee),
          0,
        ),
        tax: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.taxAmount),
          0,
        ),
        discount: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.discountAmount),
          0,
        ),
        revenue: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.totalAmount),
          0,
        ),
      }));

    const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);

    return {
      title: 'Revenue Report',
      generatedAt: new Date(),
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'orders', label: 'Orders' },
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'deliveryFee', label: 'Delivery Fee' },
        { key: 'tax', label: 'Tax' },
        { key: 'discount', label: 'Discount' },
        { key: 'revenue', label: 'Revenue' },
      ],
      rows,
      summary: [
        {
          label: 'Date Range',
          value: `${dayKey(dateFrom)} to ${dayKey(dateTo)}`,
        },
        { label: 'Delivered Orders', value: orders.length },
        { label: 'Total Revenue', value: totalRevenue.toFixed(2) },
      ],
    };
  }

  async getTaxSummary(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const { dateFrom, dateTo } = resolveRange(query);
    const orders = await this.reportsRepository.findOrders(restaurantId, {
      branchId: query.branchId,
      status: OrderStatus.DELIVERED,
      dateFrom,
      dateTo,
    });

    const byDay = new Map<string, typeof orders>();
    for (const order of orders) {
      const key = dayKey(order.placedAt);
      const list = byDay.get(key) ?? [];
      list.push(order);
      byDay.set(key, list);
    }

    const rows = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, dayOrders]) => ({
        date,
        orders: dayOrders.length,
        taxableSubtotal: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.subtotalAmount),
          0,
        ),
        tax: dayOrders.reduce(
          (sum, order) => sum + toNumber(order.taxAmount),
          0,
        ),
      }));

    const totalTax = rows.reduce((sum, row) => sum + row.tax, 0);

    return {
      title: 'Tax Summary',
      generatedAt: new Date(),
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'orders', label: 'Orders' },
        { key: 'taxableSubtotal', label: 'Taxable Subtotal' },
        { key: 'tax', label: 'Tax Collected' },
      ],
      rows,
      summary: [
        {
          label: 'Date Range',
          value: `${dayKey(dateFrom)} to ${dayKey(dateTo)}`,
        },
        { label: 'Total Tax Collected', value: totalTax.toFixed(2) },
      ],
    };
  }

  async getPaymentSummary(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const { dateFrom, dateTo } = resolveRange(query);
    const payments = await this.reportsRepository.findPayments(restaurantId, {
      branchId: query.branchId,
      paymentMode: query.paymentMode,
      dateFrom,
      dateTo,
    });

    const byMethod = new Map<string, typeof payments>();
    for (const payment of payments) {
      const key = payment.method ?? 'UNSPECIFIED';
      const list = byMethod.get(key) ?? [];
      list.push(payment);
      byMethod.set(key, list);
    }

    const rows = [...byMethod.entries()].map(([method, methodPayments]) => ({
      method,
      transactions: methodPayments.length,
      successful: methodPayments.filter((p) => p.status === 'SUCCESS').length,
      failed: methodPayments.filter((p) => p.status === 'FAILED').length,
      totalAmount: methodPayments
        .filter((p) => p.status === 'SUCCESS')
        .reduce((sum, p) => sum + toNumber(p.amount), 0),
    }));

    const totalCollected = rows.reduce((sum, row) => sum + row.totalAmount, 0);

    return {
      title: 'Payment Summary',
      generatedAt: new Date(),
      columns: [
        { key: 'method', label: 'Method' },
        { key: 'transactions', label: 'Transactions' },
        { key: 'successful', label: 'Successful' },
        { key: 'failed', label: 'Failed' },
        { key: 'totalAmount', label: 'Total Collected' },
      ],
      rows,
      summary: [
        {
          label: 'Date Range',
          value: `${dayKey(dateFrom)} to ${dayKey(dateTo)}`,
        },
        { label: 'Total Transactions', value: payments.length },
        { label: 'Total Collected', value: totalCollected.toFixed(2) },
      ],
    };
  }

  async getCancelledOrdersReport(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const { dateFrom, dateTo } = resolveRange(query);
    const orders = await this.reportsRepository.findOrders(restaurantId, {
      branchId: query.branchId,
      status: OrderStatus.CANCELLED,
      dateFrom,
      dateTo,
    });

    const totalValue = orders.reduce(
      (sum, order) => sum + toNumber(order.totalAmount),
      0,
    );

    return {
      title: 'Cancelled Orders Report',
      generatedAt: new Date(),
      columns: [
        { key: 'orderNumber', label: 'Order #' },
        { key: 'placedAt', label: 'Placed At' },
        { key: 'paymentMode', label: 'Payment Mode' },
        { key: 'paymentStatus', label: 'Payment Status' },
        { key: 'total', label: 'Order Value' },
      ],
      rows: orders.map((order) => ({
        orderNumber: order.orderNumber,
        placedAt: order.placedAt.toLocaleString(),
        paymentMode: order.paymentMode,
        paymentStatus: order.paymentStatus,
        total: toNumber(order.totalAmount),
      })),
      summary: [
        {
          label: 'Date Range',
          value: `${dayKey(dateFrom)} to ${dayKey(dateTo)}`,
        },
        { label: 'Cancelled Orders', value: orders.length },
        { label: 'Total Value Cancelled', value: totalValue.toFixed(2) },
      ],
    };
  }

  async getRefundSummary(
    restaurantId: string,
    query: GetReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<ReportTable> {
    await this.assertCanViewReports(restaurantId, user);

    const { dateFrom, dateTo } = resolveRange(query);
    const refunds = await this.reportsRepository.findRefunds(restaurantId, {
      branchId: query.branchId,
      dateFrom,
      dateTo,
    });

    const totalRefunded = refunds
      .filter((refund) => refund.status === 'SUCCESS')
      .reduce((sum, refund) => sum + toNumber(refund.amount), 0);

    return {
      title: 'Refund Summary',
      generatedAt: new Date(),
      columns: [
        { key: 'orderNumber', label: 'Order #' },
        { key: 'amount', label: 'Amount' },
        { key: 'status', label: 'Status' },
        { key: 'reason', label: 'Reason' },
        { key: 'createdAt', label: 'Date' },
      ],
      rows: refunds.map((refund) => ({
        orderNumber: refund.payment.order.orderNumber,
        amount: toNumber(refund.amount),
        status: refund.status,
        reason: refund.reason ?? '',
        createdAt: refund.createdAt.toLocaleString(),
      })),
      summary: [
        {
          label: 'Date Range',
          value: `${dayKey(dateFrom)} to ${dayKey(dateTo)}`,
        },
        { label: 'Total Refunds', value: refunds.length },
        { label: 'Total Amount Refunded', value: totalRefunded.toFixed(2) },
      ],
    };
  }

  async export(
    table: ReportTable,
    format: ReportFormat,
    fileBaseName: string,
  ): Promise<ExportedFile> {
    switch (format) {
      case ReportFormat.CSV:
        return {
          buffer: toCsv(table),
          contentType: 'text/csv; charset=utf-8',
          filename: `${fileBaseName}.csv`,
        };
      case ReportFormat.XLSX:
        return {
          buffer: await toExcel(table),
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `${fileBaseName}.xlsx`,
        };
      case ReportFormat.PDF:
        return {
          buffer: await toPdf(table),
          contentType: 'application/pdf',
          filename: `${fileBaseName}.pdf`,
        };
      case ReportFormat.JSON:
      default:
        throw new Error(
          'export() should not be called for format=json — return the table directly instead.',
        );
    }
  }

  private async assertCanViewReports(
    restaurantId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...REPORT_MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to view reports for this restaurant',
      );
    }
  }
}
