import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ComplianceOverallStatus,
  DeliveryDocumentType,
  DeliveryVerificationStage,
  VerificationStatus,
} from '@prisma/client';

export class ExpiringDeliveryDocumentDto {
  @ApiProperty() documentId: string;
  @ApiProperty({ enum: DeliveryDocumentType })
  documentType: DeliveryDocumentType;
  @ApiProperty() expiryDate: Date;
}

/**
 * Computed on demand from DeliveryVerification + DeliveryDocument + DeliveryBankAccount, then
 * persisted as a write-through cache row (DeliveryComplianceSnapshot) — the endpoint always
 * returns the freshly computed value, never a stale read of that row.
 */
export class DeliveryComplianceResponseDto {
  @ApiProperty({ enum: ComplianceOverallStatus })
  overallStatus: ComplianceOverallStatus;

  @ApiProperty({ enum: DeliveryVerificationStage })
  verificationStage: DeliveryVerificationStage;

  @ApiProperty() documentsTotal: number;
  @ApiProperty() documentsVerified: number;
  @ApiProperty() documentsPending: number;
  @ApiProperty() documentsRejected: number;

  @ApiProperty({ type: [ExpiringDeliveryDocumentDto] })
  expiringWithin30Days: ExpiringDeliveryDocumentDto[];

  @ApiProperty({ type: [ExpiringDeliveryDocumentDto] })
  expired: ExpiringDeliveryDocumentDto[];

  @ApiProperty({ type: [String], enum: DeliveryDocumentType, isArray: true })
  missingDocumentTypes: DeliveryDocumentType[];

  @ApiPropertyOptional({ enum: VerificationStatus })
  bankVerificationStatus?: VerificationStatus;
}
