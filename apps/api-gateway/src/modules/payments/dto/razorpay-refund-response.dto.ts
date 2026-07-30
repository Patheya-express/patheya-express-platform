import { ApiProperty } from '@nestjs/swagger';

export class RazorpayRefundResponseDto {
  @ApiProperty({
    example: 'rfnd_JKl9876XyZ',
  })
  id: string;

  @ApiProperty({
    example: 'refund',
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
    example: 'pay_JKl9876XyZ',
  })
  payment_id: string;

  @ApiProperty({
    example: 'processed',
  })
  status: string;

  @ApiProperty({
    example: 1748505600,
  })
  created_at: number;
}
