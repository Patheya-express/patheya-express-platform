import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderStatus, PaymentStatus, PaymentMode } from '@prisma/client';

import { OrderItemResponseDto } from './order-item-response.dto';

import { OrderStatusHistoryResponseDto } from './order-status-history-response.dto';

import { OrderCustomerSummaryResponseDto } from './order-customer-summary-response.dto';

import { OrderDeliveryPartnerSummaryDto } from './order-delivery-partner-summary.dto';

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

  @ApiPropertyOptional({
    description:
      'Only populated by endpoints that already join the restaurant (e.g. order history)',
  })
  restaurantName?: string;

  @ApiProperty({
    required: false,
  })
  deliveryPartnerId?: string;

  @ApiPropertyOptional({
    type: () => OrderDeliveryPartnerSummaryDto,
    description:
      'Only populated once a delivery partner is assigned, by endpoints that join it (e.g. order detail)',
  })
  deliveryPartner?: OrderDeliveryPartnerSummaryDto;

  @ApiProperty({
    enum: OrderStatus,
  })
  status: OrderStatus;

  @ApiProperty({
    enum: PaymentStatus,
  })
  paymentStatus: PaymentStatus;

  @ApiProperty({
    enum: PaymentMode,
  })
  paymentMode: PaymentMode;

  @ApiPropertyOptional()
  addressId?: string;

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

  @ApiPropertyOptional({
    description:
      'Delivery destination latitude, resolved from the saved address at order placement',
  })
  latitude?: number;

  @ApiPropertyOptional({
    description:
      'Delivery destination longitude, resolved from the saved address at order placement',
  })
  longitude?: number;

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
