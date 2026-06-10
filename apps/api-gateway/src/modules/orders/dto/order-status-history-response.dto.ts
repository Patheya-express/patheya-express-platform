import {
    ApiProperty,
  } from '@nestjs/swagger';
  
  import {
    OrderStatus,
  } from '@prisma/client';
  
  export class OrderStatusHistoryResponseDto {
  
    @ApiProperty()
    id: string;
  
    @ApiProperty({
      enum: OrderStatus,
    })
    status: OrderStatus;
  
    @ApiProperty({
      required: false,
    })
    note?: string;
  
    @ApiProperty()
    createdAt: Date;
  
  }