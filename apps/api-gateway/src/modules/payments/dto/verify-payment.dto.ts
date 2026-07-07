import { IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class VerifyPaymentDto {
  @ApiProperty({
    example: 'order_JKl9876XyZ',
    description: 'Razorpay order ID',
  })
  @IsString()
  razorpay_order_id: string;

  @ApiProperty({
    example: 'pay_JKl9876XyZ',
    description: 'Razorpay payment ID',
  })
  @IsString()
  razorpay_payment_id: string;

  @ApiProperty({
    example: '9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
    description: 'HMAC-SHA256 signature returned by Razorpay for verification',
  })
  @IsString()
  razorpay_signature: string;
}
