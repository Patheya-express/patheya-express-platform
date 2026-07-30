import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefundPaymentDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
    description: 'Payment ID to refund',
  })
  @IsString()
  paymentId: string;

  @ApiProperty({
    example: 499.0,
    description: 'Refund amount in INR',
  })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({
    example: 'Customer requested cancellation',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
