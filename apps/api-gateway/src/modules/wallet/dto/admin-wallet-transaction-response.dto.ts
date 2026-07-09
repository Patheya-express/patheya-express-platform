import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { WalletTransactionType, WalletTransactionStatus } from '@prisma/client';

export class AdminWalletTransactionRecipientDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiPropertyOptional() lastName?: string;
  @ApiPropertyOptional() email?: string;
}

export class AdminWalletTransactionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: AdminWalletTransactionRecipientDto })
  user: AdminWalletTransactionRecipientDto;
  @ApiProperty({ enum: WalletTransactionType }) type: WalletTransactionType;
  @ApiProperty({ enum: WalletTransactionStatus })
  status: WalletTransactionStatus;
  @ApiProperty() amount: number;
  @ApiProperty() balanceAfter: number;
  @ApiPropertyOptional() orderId?: string;
  @ApiProperty() description: string;
  @ApiProperty() createdAt: Date;
}
