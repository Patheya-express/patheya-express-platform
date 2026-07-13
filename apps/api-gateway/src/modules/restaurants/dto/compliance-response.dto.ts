import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  RestaurantDocumentType,
  RestaurantVerificationStage,
} from '@prisma/client';

export class ExpiringDocumentDto {
  @ApiProperty() documentId: string;
  @ApiProperty({ enum: RestaurantDocumentType })
  documentType: RestaurantDocumentType;
  @ApiProperty() expiryDate: Date;
}

/**
 * Computed on demand from RestaurantVerification + RestaurantDocument + RestaurantTaxProfile +
 * RestaurantBankAccount — deliberately not a stored/denormalized score, per the approved
 * decision. Recompute cost is a handful of indexed queries; there is no compliance table.
 */
export class ComplianceResponseDto {
  @ApiProperty({ enum: ['COMPLIANT', 'AT_RISK', 'NON_COMPLIANT'] })
  overallStatus: 'COMPLIANT' | 'AT_RISK' | 'NON_COMPLIANT';

  @ApiProperty({ enum: RestaurantVerificationStage })
  verificationStage: RestaurantVerificationStage;

  @ApiProperty() documentsTotal: number;
  @ApiProperty() documentsVerified: number;
  @ApiProperty() documentsPending: number;
  @ApiProperty() documentsRejected: number;

  @ApiProperty({ type: [ExpiringDocumentDto] })
  expiringWithin30Days: ExpiringDocumentDto[];

  @ApiProperty({ type: [ExpiringDocumentDto] })
  expired: ExpiringDocumentDto[];

  @ApiPropertyOptional() gstVerificationStatus?: string;
  @ApiPropertyOptional() fssaiVerificationStatus?: string;
  @ApiPropertyOptional() bankVerificationStatus?: string;
}
