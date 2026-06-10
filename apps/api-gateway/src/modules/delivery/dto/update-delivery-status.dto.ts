import {
  IsEnum,
} from 'class-validator';

import {
  ApiProperty,
} from '@nestjs/swagger';

import {
  OrderStatus,
} from '@prisma/client';

export class UpdateDeliveryStatusDto {

  @ApiProperty({
    enum: OrderStatus,
    example: 'OUT_FOR_DELIVERY',
    description:
      'Updated order delivery status',
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;

}