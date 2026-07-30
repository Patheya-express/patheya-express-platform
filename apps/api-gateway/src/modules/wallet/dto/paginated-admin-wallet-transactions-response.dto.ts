import { ApiProperty } from '@nestjs/swagger';

import { AdminWalletTransactionResponseDto } from './admin-wallet-transaction-response.dto';

export class PaginatedAdminWalletTransactionsResponseDto {
  @ApiProperty({ type: [AdminWalletTransactionResponseDto] })
  items: AdminWalletTransactionResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
