import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { Type } from 'class-transformer';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PaymentMode } from '@prisma/client';

import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  restaurantId: string;

  @ApiPropertyOptional({
    description:
      'ID of a saved address. Either this or deliveryAddress must be provided.',
  })
  @IsOptional()
  @IsString()
  addressId?: string;

  @ApiPropertyOptional({
    description:
      'Free-text delivery address. Ignored if addressId is provided.',
  })
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @ApiPropertyOptional({ enum: PaymentMode, default: PaymentMode.ONLINE })
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    type: [CreateOrderItemDto],
  })
  @IsArray()
  @ValidateNested({
    each: true,
  })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
