import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { WalletTransactionType, WalletTransactionStatus } from '@prisma/client';

export class WalletTransactionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: WalletTransactionType }) type: WalletTransactionType;
  @ApiProperty({ enum: WalletTransactionStatus })
  status: WalletTransactionStatus;

  @ApiProperty({
    description: 'Positive = credit, negative = debit.',
    example: 25.5,
  })
  amount: number;

  @ApiProperty() balanceAfter: number;

  @ApiPropertyOptional() orderId?: string;
  @ApiPropertyOptional() referralId?: string;

  @ApiProperty() description: string;
  @ApiProperty() createdAt: Date;
}
