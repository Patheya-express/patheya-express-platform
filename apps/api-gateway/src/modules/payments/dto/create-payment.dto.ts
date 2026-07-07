import { IsNumber, IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
    description: 'Order ID to create a payment for',
  })
  @IsString()
  orderId: string;

  @ApiProperty({
    example: 499.0,
    description: 'Payment amount in INR',
  })
  @IsNumber()
  amount: number;
}
