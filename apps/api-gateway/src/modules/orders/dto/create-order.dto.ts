import {
    IsArray,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
  } from 'class-validator';
  
  import {
    Type,
  } from 'class-transformer';
  
  class OrderItemDto {
  
    @IsString()
  
    menuItemId: string;
  
    @IsNumber()
  
    quantity: number;
  
  }
  
  export class CreateOrderDto {
  
    @IsString()
  
    restaurantId: string;
  
    @IsOptional()
  
    @IsString()
  
    branchId?: string;
  
    @IsString()
  
    deliveryAddress: string;
  
    @IsArray()
  
    @ValidateNested({
      each: true,
    })
  
    @Type(() => OrderItemDto)
  
    items: OrderItemDto[];
  
  }