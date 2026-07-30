import { ApiProperty } from '@nestjs/swagger';

import { OrderStatus } from '@prisma/client';

export class AdminPaymentOrderSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty({
    enum: OrderStatus,
  })
  status: OrderStatus;
}
