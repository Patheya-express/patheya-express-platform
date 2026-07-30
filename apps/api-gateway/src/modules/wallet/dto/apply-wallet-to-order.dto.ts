import { IsNumber, IsPositive, IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class ApplyWalletToOrderDto {
  @ApiProperty()
  @IsString()
  orderId: string;

  @ApiProperty({
    description:
      'Amount the customer wants to apply from their wallet. Clamped server-side to the lesser of this value, the order total, and the current wallet balance.',
  })
  @IsNumber()
  @IsPositive()
  amount: number;
}
