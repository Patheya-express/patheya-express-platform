import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  PaymentProvider,
  PaymentMethod,
  TransactionStatus,
} from '@prisma/client';

export class PaymentResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  orderId: string;

  @ApiProperty({
    enum: PaymentProvider,
  })
  provider: PaymentProvider;

  @ApiPropertyOptional({
    example: 'order_JKl9876XyZ',
  })
  providerOrderId?: string;

  @ApiPropertyOptional({
    example: 'pay_JKl9876XyZ',
  })
  providerPaymentId?: string;

  @ApiProperty({
    example: 499.0,
  })
  amount: number;

  @ApiProperty({
    enum: TransactionStatus,
  })
  status: TransactionStatus;

  @ApiPropertyOptional({
    enum: PaymentMethod,
  })
  method?: PaymentMethod;

  @ApiProperty({
    example: 1,
  })
  attemptNumber: number;

  @ApiProperty({
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  updatedAt: Date;
}
