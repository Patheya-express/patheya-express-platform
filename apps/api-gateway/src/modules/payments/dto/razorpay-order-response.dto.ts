import { ApiProperty } from '@nestjs/swagger';

export class RazorpayOrderResponseDto {
  @ApiProperty({
    example: 'order_JKl9876XyZ',
  })
  id: string;

  @ApiProperty({
    example: 'order',
  })
  entity: string;

  @ApiProperty({
    description: 'Amount in the smallest currency unit (paise)',
    example: 49900,
  })
  amount: number;

  @ApiProperty({
    example: 'INR',
  })
  currency: string;

  @ApiProperty({
    example: 'order_order-id_attempt_1',
  })
  receipt: string;

  @ApiProperty({
    example: 'created',
  })
  status: string;

  @ApiProperty({
    example: 0,
  })
  attempts: number;

  @ApiProperty({
    example: 1748505600,
  })
  created_at: number;
}
