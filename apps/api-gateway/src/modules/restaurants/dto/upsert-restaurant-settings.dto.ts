import { ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { ServiceChargeType } from '@prisma/client';

export class UpsertRestaurantSettingsDto {
  @ApiPropertyOptional({ enum: ServiceChargeType })
  @IsOptional()
  @IsEnum(ServiceChargeType)
  serviceChargeType?: ServiceChargeType;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceChargeValue?: number;

  @ApiPropertyOptional({ enum: ServiceChargeType })
  @IsOptional()
  @IsEnum(ServiceChargeType)
  packingChargeType?: ServiceChargeType;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  packingChargeValue?: number;

  @ApiPropertyOptional({ example: 99 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderAmount?: number;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoAcceptOrders?: boolean;

  @ApiPropertyOptional({
    example: 10,
    description:
      'Minutes before an unaccepted order is auto-rejected (or auto-accepted).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  acceptanceTimeoutMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isTemporarilyClosed?: boolean;

  @ApiPropertyOptional({ example: 'Kitchen equipment maintenance' })
  @IsOptional()
  @IsString()
  temporaryClosureReason?: string;

  @ApiPropertyOptional({
    description: 'ISO timestamp the temporary closure ends.',
  })
  @IsOptional()
  @IsDateString()
  temporaryClosureUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  restaurantNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryRadiusOverrideKm?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderPreparationDefaultMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyOnNewOrder?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyOnOrderCancelled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyOnRefund?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyOnCustomerMessage?: boolean;
}
