import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { VehicleType } from '@prisma/client';

export class OrderDeliveryPartnerSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({ enum: VehicleType })
  vehicleType?: VehicleType;

  @ApiPropertyOptional()
  vehicleNumber?: string;
}
