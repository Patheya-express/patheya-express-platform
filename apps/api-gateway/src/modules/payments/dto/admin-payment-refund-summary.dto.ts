import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TransactionStatus } from '@prisma/client';

export class AdminPaymentRefundSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({
    enum: TransactionStatus,
  })
  status: TransactionStatus;

  @ApiProperty()
  createdAt: Date;
}
