import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  PaymentProvider,
  PaymentMethod,
  TransactionStatus,
} from '@prisma/client';

import { AdminPaymentOrderSummaryDto } from './admin-payment-order-summary.dto';
import { AdminPaymentCustomerSummaryDto } from './admin-payment-customer-summary.dto';
import { AdminPaymentRefundSummaryDto } from './admin-payment-refund-summary.dto';

/**
 * A parallel, admin-facing payment projection — deliberately not an extension of
 * PaymentResponseDto, so the create/verify/refund-facing contract never changes shape.
 */
export class AdminPaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty({
    type: AdminPaymentOrderSummaryDto,
  })
  order: AdminPaymentOrderSummaryDto;

  @ApiProperty({
    type: AdminPaymentCustomerSummaryDto,
  })
  customer: AdminPaymentCustomerSummaryDto;

  @ApiProperty()
  amount: number;

  @ApiProperty({
    enum: PaymentProvider,
  })
  provider: PaymentProvider;

  @ApiPropertyOptional({
    enum: PaymentMethod,
  })
  method?: PaymentMethod;

  @ApiProperty({
    enum: TransactionStatus,
  })
  status: TransactionStatus;

  @ApiPropertyOptional()
  providerOrderId?: string;

  @ApiPropertyOptional()
  providerPaymentId?: string;

  @ApiProperty({
    type: AdminPaymentRefundSummaryDto,
    isArray: true,
  })
  refunds: AdminPaymentRefundSummaryDto[];

  @ApiProperty()
  attemptNumber: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
