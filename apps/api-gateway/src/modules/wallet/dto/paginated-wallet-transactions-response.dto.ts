import { ApiProperty } from '@nestjs/swagger';

import { WalletTransactionResponseDto } from './wallet-transaction-response.dto';

export class PaginatedWalletTransactionsResponseDto {
  @ApiProperty({ type: [WalletTransactionResponseDto] })
  items: WalletTransactionResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
