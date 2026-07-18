import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DeliveryVerificationStage } from '@prisma/client';

export class DeliveryVerificationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() deliveryPartnerId: string;
  @ApiProperty({ enum: DeliveryVerificationStage })
  stage: DeliveryVerificationStage;
  @ApiPropertyOptional() submittedAt?: Date;
  @ApiPropertyOptional() decidedAt?: Date;
  @ApiPropertyOptional() rejectedReason?: string;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class VerificationHistoryEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() deliveryPartnerId: string;
  @ApiPropertyOptional({ enum: DeliveryVerificationStage })
  fromStage?: DeliveryVerificationStage;
  @ApiProperty({ enum: DeliveryVerificationStage })
  toStage: DeliveryVerificationStage;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() decidedById?: string;
  @ApiProperty() createdAt: Date;
}
