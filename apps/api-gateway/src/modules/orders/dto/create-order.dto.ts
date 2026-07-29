import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
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

  @ApiPropertyOptional({
    description: 'A coupon code to apply to this order, if any.',
  })
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiProperty({
    type: [CreateOrderItemDto],
  })
  @IsArray()
  @ValidateNested({
    each: true,
  })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({
    description:
      'Client-generated UUID identifying this checkout attempt. Generate one per attempt and ' +
      'reuse the SAME value on any retry of the same attempt (double-click, network timeout, ' +
      'browser/mobile resubmit) — replaying a key that already produced an order returns that ' +
      'same order instead of creating a new one. Generate a new UUID only after a successful ' +
      'order or an explicit cancel.',
  })
  @IsUUID('4')
  idempotencyKey: string;
}
