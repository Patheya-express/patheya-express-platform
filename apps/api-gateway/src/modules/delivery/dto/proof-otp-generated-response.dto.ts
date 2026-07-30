import { ApiProperty } from '@nestjs/swagger';

import { DeliveryProofType } from '@prisma/client';

export class ProofOtpGeneratedResponseDto {
  @ApiProperty()
  orderId: string;

  @ApiProperty({ enum: DeliveryProofType })
  type: DeliveryProofType;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  maxAttempts: number;
}
