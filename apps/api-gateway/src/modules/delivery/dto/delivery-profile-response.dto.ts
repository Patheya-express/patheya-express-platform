import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DeliveryPartnerStatus, Gender, VehicleType } from '@prisma/client';

export class DeliveryProfileResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty({ enum: VehicleType }) vehicleType: VehicleType;
  @ApiProperty() vehicleNumber: string;
  @ApiPropertyOptional() licenseNumber?: string;
  @ApiProperty({ enum: DeliveryPartnerStatus }) status: DeliveryPartnerStatus;
  @ApiProperty() isVerified: boolean;

  @ApiPropertyOptional() dateOfBirth?: Date;
  @ApiPropertyOptional({ enum: Gender }) gender?: Gender;

  @ApiPropertyOptional() permanentAddressLine1?: string;
  @ApiPropertyOptional() permanentAddressLine2?: string;
  @ApiPropertyOptional() permanentCity?: string;
  @ApiPropertyOptional() permanentState?: string;
  @ApiPropertyOptional() permanentPostalCode?: string;
  @ApiPropertyOptional() permanentLatitude?: number;
  @ApiPropertyOptional() permanentLongitude?: number;

  @ApiProperty() sameAsPermanentAddress: boolean;

  @ApiPropertyOptional() currentAddressLine1?: string;
  @ApiPropertyOptional() currentAddressLine2?: string;
  @ApiPropertyOptional() currentCity?: string;
  @ApiPropertyOptional() currentState?: string;
  @ApiPropertyOptional() currentPostalCode?: string;
  @ApiPropertyOptional() currentAddressLatitude?: number;
  @ApiPropertyOptional() currentAddressLongitude?: number;

  @ApiPropertyOptional() emergencyContactName?: string;
  @ApiPropertyOptional() emergencyContactPhone?: string;
  @ApiPropertyOptional() emergencyContactRelation?: string;

  @ApiProperty({ type: [String] }) languagesSpoken: string[];

  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
