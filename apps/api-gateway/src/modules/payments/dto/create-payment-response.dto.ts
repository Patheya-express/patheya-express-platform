import { ApiProperty } from '@nestjs/swagger';

import { PaymentResponseDto } from './payment-response.dto';

import { RazorpayOrderResponseDto } from './razorpay-order-response.dto';

export class CreatePaymentResponseDto {
  @ApiProperty({
    type: PaymentResponseDto,
  })
  payment: PaymentResponseDto;

  @ApiProperty({
    type: RazorpayOrderResponseDto,
  })
  providerOrder: RazorpayOrderResponseDto;
}
