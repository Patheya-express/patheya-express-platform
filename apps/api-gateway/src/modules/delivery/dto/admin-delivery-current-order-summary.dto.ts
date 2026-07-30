import { ApiProperty } from '@nestjs/swagger';

import { OrderStatus } from '@prisma/client';

export class AdminDeliveryCurrentOrderSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty({
    enum: OrderStatus,
  })
  status: OrderStatus;

  @ApiProperty()
  restaurantName: string;
}
