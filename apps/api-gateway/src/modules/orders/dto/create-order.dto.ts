import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import {
  Type,
} from 'class-transformer';

import {
  CreateOrderItemDto,
} from './create-order-item.dto';

export class CreateOrderDto {

  @IsString()
  restaurantId: string;

  @IsString()
  deliveryAddress: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({
    each: true,
  })
  @Type(
    () => CreateOrderItemDto,
  )
  items: CreateOrderItemDto[];

}