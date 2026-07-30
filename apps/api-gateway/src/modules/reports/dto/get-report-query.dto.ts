import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

import { OrderStatus, PaymentMode } from '@prisma/client';

export enum ReportFormat {
  JSON = 'json',
  CSV = 'csv',
  XLSX = 'xlsx',
  PDF = 'pdf',
}

/** Shared across every report endpoint — each report type only reads the filters relevant to it
 *  (e.g. Tax Summary ignores `status`), so one DTO covers all of them instead of seven near-
 *  identical ones. */
export class GetReportQueryDto {
  @ApiPropertyOptional({
    description:
      'Start of the date range (inclusive). Defaults per report type.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'End of the date range (inclusive). Defaults per report type.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Restrict to a single branch. Omit for all branches.',
  })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Orders Report only.',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    enum: PaymentMode,
    description: 'Payment Summary only.',
  })
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @ApiPropertyOptional({
    enum: ReportFormat,
    default: ReportFormat.JSON,
    description:
      'json returns a preview payload; csv/xlsx/pdf return a file download.',
  })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat = ReportFormat.JSON;
}
