import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { VehicleType, DeliveryPartnerStatus } from '@prisma/client';

export class DeliveryPartnerResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  userId: string;

  @ApiProperty({
    enum: VehicleType,
  })
  vehicleType: VehicleType;

  @ApiProperty({
    example: 'KA01AB1234',
  })
  vehicleNumber: string;

  @ApiPropertyOptional({
    example: 'DL123456789',
  })
  licenseNumber?: string;

  @ApiProperty({
    enum: DeliveryPartnerStatus,
  })
  status: DeliveryPartnerStatus;

  @ApiPropertyOptional({
    example: 12.9716,
  })
  currentLatitude?: number;

  @ApiPropertyOptional({
    example: 77.5946,
  })
  currentLongitude?: number;

  @ApiProperty({
    example: false,
  })
  isVerified: boolean;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  updatedAt: Date;
}
