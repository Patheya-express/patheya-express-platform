import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  TransactionStatus,
  PaymentProvider,
  PaymentMethod,
} from '@prisma/client';

export class AdminOrderPaymentSummaryDto {
  @ApiProperty({
    enum: TransactionStatus,
  })
  status: TransactionStatus;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional({
    enum: PaymentMethod,
  })
  method?: PaymentMethod;

  @ApiPropertyOptional({
    enum: PaymentProvider,
  })
  provider?: PaymentProvider;
}
