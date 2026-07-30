import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class AdminAdjustWalletDto {
  @ApiProperty({
    description: 'Positive to credit, negative to debit.',
    example: 50,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'Goodwill credit for delayed delivery' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
