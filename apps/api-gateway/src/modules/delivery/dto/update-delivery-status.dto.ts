import {
    IsEnum,
  } from 'class-validator';
  
  import {
    OrderStatus,
  } from '@prisma/client';
  
  export class UpdateDeliveryStatusDto {
  
    @IsEnum(OrderStatus)
  
    status: OrderStatus;
  
  }