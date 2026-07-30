import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantDocumentType, VerificationStatus } from '@prisma/client';

export class DocumentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiPropertyOptional() branchId?: string;
  @ApiProperty({ enum: RestaurantDocumentType })
  documentType: RestaurantDocumentType;
  @ApiPropertyOptional() documentNumber?: string;
  @ApiPropertyOptional() issueDate?: Date;
  @ApiPropertyOptional() expiryDate?: Date;
  @ApiProperty({ enum: VerificationStatus }) status: VerificationStatus;
  @ApiProperty() storageUrl: string;
  @ApiProperty() fileName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty() uploadedById: string;
  @ApiPropertyOptional() verifiedById?: string;
  @ApiPropertyOptional() verifiedAt?: Date;
  @ApiPropertyOptional() rejectedReason?: string;
  @ApiProperty() version: number;
  @ApiProperty() isLatest: boolean;
  @ApiPropertyOptional() previousVersionId?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
