import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BusinessType, VerificationStatus } from '@prisma/client';

export class TaxProfileResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;

  @ApiPropertyOptional() gstin?: string;
  @ApiPropertyOptional() gstLegalName?: string;
  @ApiPropertyOptional() gstRegisteredAddress?: string;
  @ApiPropertyOptional() gstBusinessCategory?: string;
  @ApiPropertyOptional() gstRegistrationState?: string;
  @ApiProperty({ enum: VerificationStatus })
  gstVerificationStatus: VerificationStatus;
  @ApiPropertyOptional() gstVerifiedAt?: Date;

  @ApiPropertyOptional() fssaiNumber?: string;
  @ApiPropertyOptional() fssaiLicenseType?: string;
  @ApiPropertyOptional() fssaiIssueDate?: Date;
  @ApiPropertyOptional() fssaiExpiryAt?: Date;
  @ApiProperty({ enum: VerificationStatus })
  fssaiVerificationStatus: VerificationStatus;
  @ApiPropertyOptional() fssaiVerifiedAt?: Date;

  @ApiPropertyOptional() pan?: string;
  @ApiPropertyOptional() cin?: string;
  @ApiPropertyOptional({ enum: BusinessType }) businessType?: BusinessType;

  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
