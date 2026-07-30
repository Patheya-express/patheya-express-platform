import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderStatus, PaymentStatus } from '@prisma/client';

import { OrderItemResponseDto } from './order-item-response.dto';
import { OrderStatusHistoryResponseDto } from './order-status-history-response.dto';
import { AdminOrderCustomerSummaryDto } from './admin-order-customer-summary.dto';
import { AdminOrderRestaurantSummaryDto } from './admin-order-restaurant-summary.dto';
import { AdminOrderDeliveryPartnerSummaryDto } from './admin-order-delivery-partner-summary.dto';
import { AdminOrderPaymentSummaryDto } from './admin-order-payment-summary.dto';

/**
 * A parallel, admin-facing order projection — deliberately not an extension of
 * OrderResponseDto, so the customer/restaurant-facing contract never changes shape.
 */
export class AdminOrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  customerId: string;

  @ApiProperty({
    type: AdminOrderCustomerSummaryDto,
  })
  customer: AdminOrderCustomerSummaryDto;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty({
    type: AdminOrderRestaurantSummaryDto,
  })
  restaurant: AdminOrderRestaurantSummaryDto;

  @ApiPropertyOptional()
  deliveryPartnerId?: string;

  @ApiPropertyOptional({
    type: AdminOrderDeliveryPartnerSummaryDto,
  })
  deliveryPartner?: AdminOrderDeliveryPartnerSummaryDto;

  @ApiProperty({
    enum: OrderStatus,
  })
  status: OrderStatus;

  @ApiProperty({
    enum: PaymentStatus,
  })
  paymentStatus: PaymentStatus;

  @ApiPropertyOptional({
    type: AdminOrderPaymentSummaryDto,
  })
  payment?: AdminOrderPaymentSummaryDto;

  @ApiProperty()
  subtotalAmount: number;

  @ApiProperty()
  deliveryFee: number;

  @ApiProperty()
  taxAmount: number;

  @ApiPropertyOptional()
  couponId?: string;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  deliveryAddress: string;

  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional()
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
