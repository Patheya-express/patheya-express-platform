import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { OrderStatus, PaymentMode } from '@prisma/client';

import type { Response } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { ReportsService } from '../services/reports.service';
import { GetReportQueryDto, ReportFormat } from '../dto/get-report-query.dto';
import { ReportResponseDto } from '../dto/report-response.dto';
import { ReportTable } from '../exporters/report-table.type';

type ReportBuilder = (
  restaurantId: string,
  query: GetReportQueryDto,
  user: any,
) => Promise<ReportTable>;

/** Applied to every report endpoint below — all seven share the exact same query surface
 *  (GetReportQueryDto), so this one decorator array keeps that in sync instead of retyping it
 *  seven times. */
function ReportEndpointDocs(summary: string, description: string) {
  return applyDecorators(
    ApiOperation({ summary, description }),
    ApiParam({ name: 'restaurantId' }),
    ApiQuery({
      name: 'dateFrom',
      required: false,
      description: 'Inclusive start date (ISO). Defaults per report type.',
    }),
    ApiQuery({
      name: 'dateTo',
      required: false,
      description: 'Inclusive end date (ISO). Defaults per report type.',
    }),
    ApiQuery({ name: 'branchId', required: false }),
    ApiQuery({
      name: 'status',
      required: false,
      enum: OrderStatus,
      description: 'Orders Report only.',
    }),
    ApiQuery({
      name: 'paymentMode',
      required: false,
      enum: PaymentMode,
      description: 'Payment Summary only.',
    }),
    ApiQuery({
      name: 'format',
      required: false,
      enum: ReportFormat,
      description:
        'json (default) returns a preview payload; csv/xlsx/pdf return a file download.',
    }),
    ApiOkResponse({
      description: 'Report generated successfully',
      type: ReportResponseDto,
    }),
    ApiForbiddenResponse({
      description: 'Caller does not manage this restaurant',
    }),
  );
}

@ApiTags('Restaurant Reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(':restaurantId/daily-sales')
  @ReportEndpointDocs(
    'Daily Sales Report',
    'Every order placed on a single day (dateFrom, default today), with a delivered/cancelled/revenue summary. Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  )
  dailySales(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      restaurantId,
      query,
      user,
      res,
      'daily-sales',
      (id, q, u) => this.reportsService.getDailySalesReport(id, q, u),
    );
  }

  @Get(':restaurantId/orders')
  @ReportEndpointDocs(
    'Orders Report',
    'Every order in the date range, optionally filtered by branch/status.',
  )
  orders(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(restaurantId, query, user, res, 'orders', (id, q, u) =>
      this.reportsService.getOrdersReport(id, q, u),
    );
  }

  @Get(':restaurantId/revenue')
  @ReportEndpointDocs(
    'Revenue Report',
    'Delivered-order revenue, grouped by day, over the date range.',
  )
  revenue(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(restaurantId, query, user, res, 'revenue', (id, q, u) =>
      this.reportsService.getRevenueReport(id, q, u),
    );
  }

  @Get(':restaurantId/tax-summary')
  @ReportEndpointDocs(
    'Tax Summary',
    'Tax collected on delivered orders, grouped by day, over the date range.',
  )
  taxSummary(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      restaurantId,
      query,
      user,
      res,
      'tax-summary',
      (id, q, u) => this.reportsService.getTaxSummary(id, q, u),
    );
  }

  @Get(':restaurantId/payment-summary')
  @ReportEndpointDocs(
    'Payment Summary',
    'Payment transactions grouped by method, over the date range.',
  )
  paymentSummary(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      restaurantId,
      query,
      user,
      res,
      'payment-summary',
      (id, q, u) => this.reportsService.getPaymentSummary(id, q, u),
    );
  }

  @Get(':restaurantId/cancelled-orders')
  @ReportEndpointDocs(
    'Cancelled Orders Report',
    'Every cancelled order in the date range.',
  )
  cancelledOrders(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      restaurantId,
      query,
      user,
      res,
      'cancelled-orders',
      (id, q, u) => this.reportsService.getCancelledOrdersReport(id, q, u),
    );
  }

  @Get(':restaurantId/refund-summary')
  @ReportEndpointDocs(
    'Refund Summary',
    'Every refund in the date range, across all payment methods.',
  )
  refundSummary(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      restaurantId,
      query,
      user,
      res,
      'refund-summary',
      (id, q, u) => this.reportsService.getRefundSummary(id, q, u),
    );
  }

  /**
   * Single path every report endpoint above funnels through: build the report table, then either
   * return it as JSON (format=json, the default) or stream it as a CSV/Excel/PDF file download —
   * the one place that decision is made, so each report method above only ever states its own
   * aggregation query.
   */
  private async respond(
    restaurantId: string,
    query: GetReportQueryDto,
    user: any,
    res: Response,
    fileBaseName: string,
    build: ReportBuilder,
  ): Promise<ReportResponseDto | StreamableFile> {
    const table = await build(restaurantId, query, user);
    const format = query.format ?? ReportFormat.JSON;

    if (format === ReportFormat.JSON) {
      return table;
    }

    const exported = await this.reportsService.export(
      table,
      format,
      fileBaseName,
    );

    res.set({
      'Content-Type': exported.contentType,
      'Content-Disposition': `attachment; filename="${exported.filename}"`,
    });

    return new StreamableFile(exported.buffer);
  }
}
