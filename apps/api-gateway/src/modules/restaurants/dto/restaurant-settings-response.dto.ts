import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ServiceChargeType } from '@prisma/client';

export class RestaurantSettingsResponseDto {
  @ApiPropertyOptional() id?: string;
  @ApiProperty() restaurantId: string;

  @ApiProperty({ enum: ServiceChargeType })
  serviceChargeType: ServiceChargeType;
  @ApiProperty() serviceChargeValue: number;

  @ApiProperty({ enum: ServiceChargeType })
  packingChargeType: ServiceChargeType;
  @ApiProperty() packingChargeValue: number;

  @ApiProperty() minimumOrderAmount: number;
  @ApiProperty() currency: string;

  @ApiProperty() autoAcceptOrders: boolean;
  @ApiProperty() acceptanceTimeoutMinutes: number;

  @ApiProperty() isTemporarilyClosed: boolean;
  @ApiPropertyOptional() temporaryClosureReason?: string;
  @ApiPropertyOptional() temporaryClosureUntil?: Date;

  @ApiPropertyOptional() restaurantNotes?: string;
  @ApiPropertyOptional() specialInstructions?: string;

  @ApiPropertyOptional() deliveryRadiusOverrideKm?: number;
  @ApiPropertyOptional() orderPreparationDefaultMinutes?: number;

  @ApiProperty() notifyOnNewOrder: boolean;
  @ApiProperty() notifyOnOrderCancelled: boolean;
  @ApiProperty() notifyOnRefund: boolean;
  @ApiProperty() notifyOnCustomerMessage: boolean;

  @ApiPropertyOptional() createdAt?: Date;
  @ApiPropertyOptional() updatedAt?: Date;
}
