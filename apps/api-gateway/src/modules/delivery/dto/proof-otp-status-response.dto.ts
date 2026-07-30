import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  DeliveryProofType,
  DeliveryProofOtpStatus,
  OrderStatus,
} from '@prisma/client';

export class ProofOtpStatusResponseDto {
  @ApiProperty()
  orderId: string;

  @ApiProperty({ enum: DeliveryProofType })
  type: DeliveryProofType;

  @ApiProperty({ enum: DeliveryProofOtpStatus })
  status: DeliveryProofOtpStatus;

  @ApiProperty()
  attempts: number;

  @ApiProperty()
  maxAttempts: number;

  @ApiProperty()
  attemptsRemaining: number;

  @ApiProperty()
  expiresAt: Date;

  @ApiPropertyOptional()
  verifiedAt?: Date;

  @ApiProperty({
    enum: OrderStatus,
    description: 'The order status after this verification attempt/query',
  })
  orderStatus: OrderStatus;
}
