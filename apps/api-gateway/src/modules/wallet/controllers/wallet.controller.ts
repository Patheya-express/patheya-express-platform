import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { WalletService } from '../services/wallet.service';

import { GetWalletTransactionsQueryDto } from '../dto/get-wallet-transactions-query.dto';
import { GetAdminWalletTransactionsQueryDto } from '../dto/get-admin-wallet-transactions-query.dto';
import { ApplyWalletToOrderDto } from '../dto/apply-wallet-to-order.dto';
import { AdminAdjustWalletDto } from '../dto/admin-adjust-wallet.dto';
import { WalletBalanceResponseDto } from '../dto/wallet-balance-response.dto';
import { PaginatedWalletTransactionsResponseDto } from '../dto/paginated-wallet-transactions-response.dto';
import { PaginatedAdminWalletTransactionsResponseDto } from '../dto/paginated-admin-wallet-transactions-response.dto';
import { ApplyWalletToOrderResponseDto } from '../dto/apply-wallet-to-order-response.dto';
import { WalletTransactionResponseDto } from '../dto/wallet-transaction-response.dto';
import { ReferralSummaryResponseDto } from '../dto/referral-summary-response.dto';

@ApiTags('Wallet')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  @ApiOperation({ summary: "Get the authenticated user's wallet balance" })
  @ApiOkResponse({ type: WalletBalanceResponseDto })
  async getBalance(
    @CurrentUser()
    user: any,
  ): Promise<WalletBalanceResponseDto> {
    const balance = await this.walletService.getBalance(user.userId);
    return { balance };
  }

  @Get('transactions')
  @ApiOperation({
    summary: "Get the authenticated user's wallet transaction history",
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: PaginatedWalletTransactionsResponseDto })
  getTransactions(
    @CurrentUser()
    user: any,

    @Query()
    query: GetWalletTransactionsQueryDto,
  ) {
    return this.walletService.getTransactions(
      user.userId,
      query.page,
      query.limit,
    );
  }

  @Get('referral')
  @ApiOperation({
    summary: "Get the authenticated user's referral code and stats",
  })
  @ApiOkResponse({ type: ReferralSummaryResponseDto })
  getReferralSummary(
    @CurrentUser()
    user: any,
  ) {
    return this.walletService.getReferralSummary(user.userId);
  }

  @Post('apply-to-order')
  @ApiOperation({
    summary: 'Apply wallet balance to an order (mixed payment)',
    description:
      'Debits the wallet by min(requested amount, balance, order total). If that fully covers the order, the order is marked paid immediately; otherwise the response includes the remaining amount to charge via POST /payments/create.',
  })
  @ApiOkResponse({ type: ApplyWalletToOrderResponseDto })
  applyToOrder(
    @CurrentUser()
    user: any,

    @Body()
    dto: ApplyWalletToOrderDto,
  ) {
    return this.walletService.applyToOrder(
      user.userId,
      dto.orderId,
      dto.amount,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/transactions')
  @ApiOperation({
    summary:
      'Admin — list wallet transactions platform-wide, optionally filtered by user',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'userId', required: false })
  @ApiOkResponse({ type: PaginatedAdminWalletTransactionsResponseDto })
  getAllForAdmin(
    @Query()
    query: GetAdminWalletTransactionsQueryDto,
  ) {
    return this.walletService.getAllForAdmin(
      query.userId,
      query.page,
      query.limit,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('admin/:userId/adjust')
  @ApiOperation({
    summary: "Admin — manually adjust a user's wallet balance",
    description:
      'Positive amount credits, negative amount debits (still subject to the non-negative-balance guard).',
  })
  @ApiParam({ name: 'userId' })
  @ApiOkResponse({ type: WalletTransactionResponseDto })
  adjustBalance(
    @Param('userId')
    userId: string,

    @Body()
    dto: AdminAdjustWalletDto,
  ) {
    return this.walletService.adminAdjustBalance(
      userId,
      dto.amount,
      dto.reason,
    );
  }
}
