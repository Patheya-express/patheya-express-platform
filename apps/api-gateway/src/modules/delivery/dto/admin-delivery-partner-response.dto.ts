import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DeliveryPartnerStatus, VehicleType } from '@prisma/client';

import { AdminDeliveryPartnerUserSummaryDto } from './admin-delivery-partner-user-summary.dto';
import { AdminDeliveryCurrentOrderSummaryDto } from './admin-delivery-current-order-summary.dto';

/**
 * A parallel, admin-facing delivery partner projection — deliberately not an extension of
 * DeliveryPartnerResponseDto, so the partner-facing contract never changes shape.
 */
export class AdminDeliveryPartnerResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    type: AdminDeliveryPartnerUserSummaryDto,
  })
  user: AdminDeliveryPartnerUserSummaryDto;

  @ApiProperty({
    enum: VehicleType,
  })
  vehicleType: VehicleType;

  @ApiProperty()
  vehicleNumber: string;

  @ApiPropertyOptional()
  licenseNumber?: string;

  @ApiProperty({
    enum: DeliveryPartnerStatus,
    description: 'Durable operational status, toggled by the partner (available/offline) or an admin (suspend/restore).',
  })
  status: DeliveryPartnerStatus;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty({
    description: 'Live presence from Redis — distinct from `status`, which is the durable DB flag. The two can disagree.',
  })
  online: boolean;

  @ApiPropertyOptional({
    type: AdminDeliveryCurrentOrderSummaryDto,
    description: 'The partner\'s current non-terminal order, if any.',
  })
  currentOrder?: AdminDeliveryCurrentOrderSummaryDto;

  @ApiProperty({
    description: 'Total deliveries ever completed.',
  })
  completedDeliveries: number;

  @ApiProperty({
    description: 'Deliveries completed today.',
  })
  todaysDeliveries: number;

  @ApiProperty({
    description: 'Sum of deliveryFee across today\'s completed deliveries.',
  })
  estimatedFeesToday: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
