import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { FuelType, VehicleType, VerificationStatus } from '@prisma/client';

export class VehicleResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() deliveryPartnerId: string;
  @ApiProperty({ enum: VehicleType }) vehicleType: VehicleType;
  @ApiProperty() registrationNumber: string;
  @ApiPropertyOptional() brand?: string;
  @ApiPropertyOptional() model?: string;
  @ApiPropertyOptional() year?: number;
  @ApiPropertyOptional({ enum: FuelType }) fuelType?: FuelType;
  @ApiPropertyOptional() color?: string;
  @ApiProperty() isPrimary: boolean;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional() insuranceExpiryAt?: Date;
  @ApiPropertyOptional() rcExpiryAt?: Date;
  @ApiPropertyOptional() fitnessExpiryAt?: Date;
  @ApiPropertyOptional() pollutionExpiryAt?: Date;
  @ApiProperty({ enum: VerificationStatus })
  verificationStatus: VerificationStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
