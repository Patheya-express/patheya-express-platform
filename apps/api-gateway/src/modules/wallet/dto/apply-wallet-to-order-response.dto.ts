import { ApiProperty } from '@nestjs/swagger';

export class ApplyWalletToOrderResponseDto {
  @ApiProperty() walletAmountApplied: number;

  @ApiProperty({
    description:
      'Remaining amount still payable via Razorpay. Zero if the wallet covered the order in full.',
  })
  remainingAmount: number;
}
