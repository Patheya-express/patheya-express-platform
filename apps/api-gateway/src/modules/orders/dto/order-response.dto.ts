import { ApiProperty } from '@nestjs/swagger';

import { OrderStatus, PaymentStatus } from '@prisma/client';

import { OrderItemResponseDto } from './order-item-response.dto';

import { OrderStatusHistoryResponseDto } from './order-status-history-response.dto';

import { OrderCustomerSummaryResponseDto } from './order-customer-summary-response.dto';

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  customerId: string;

  @ApiProperty({
    required: false,
    type: () => OrderCustomerSummaryResponseDto,
  })
  customer?: OrderCustomerSummaryResponseDto;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty({
    required: false,
  })
  deliveryPartnerId?: string;

  @ApiProperty({
    enum: OrderStatus,
  })
  status: OrderStatus;

  @ApiProperty({
    enum: PaymentStatus,
  })
  paymentStatus: PaymentStatus;

  @ApiProperty()
  subtotalAmount: number;

  @ApiProperty()
  deliveryFee: number;

  @ApiProperty()
  taxAmount: number;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  deliveryAddress: string;

  @ApiProperty({
    required: false,
  })
  notes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    required: false,
  })
  deliveredAt?: Date;

  @ApiProperty({
    type: [OrderItemResponseDto],
  })
  items: OrderItemResponseDto[];

  @ApiProperty({
    type: [OrderStatusHistoryResponseDto],
  })
  statusHistory: OrderStatusHistoryResponseDto[];
}
