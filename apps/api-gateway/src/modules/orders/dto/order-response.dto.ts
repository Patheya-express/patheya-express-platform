import {
    ApiProperty,
  } from '@nestjs/swagger';
  
  import {
    OrderStatus,
    PaymentStatus,
  } from '@prisma/client';
  
  import {
    OrderItemResponseDto,
  } from './order-item-response.dto';
  
  import {
    OrderStatusHistoryResponseDto,
  } from './order-status-history-response.dto';
  
  export class OrderResponseDto {
  
    @ApiProperty()
    id: string;
  
    @ApiProperty()
    orderNumber: string;
  
    @ApiProperty()
    customerId: string;
  
    @ApiProperty()
    restaurantId: string;
  
    @ApiProperty()
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
      type:
        [OrderItemResponseDto],
    })
    items:
      OrderItemResponseDto[];
  
    @ApiProperty({
      type:
        [OrderStatusHistoryResponseDto],
    })
    statusHistory:
      OrderStatusHistoryResponseDto[];
  
  }