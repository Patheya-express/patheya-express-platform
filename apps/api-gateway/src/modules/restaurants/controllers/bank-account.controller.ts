import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { BankAccountService } from '../services/bank-account.service';

import { UpsertBankAccountDto } from '../dto/upsert-bank-account.dto';
import { BankAccountResponseDto } from '../dto/bank-account-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Bank Account')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/bank-account')
@UseGuards(JwtAuthGuard)
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @ApiOperation({ summary: 'Get bank account (last-4 masked only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: BankAccountResponseDto })
  @Get()
  find(@CurrentUser() user: any, @Param('restaurantId') restaurantId: string) {
    return this.bankAccountService.find(restaurantId, user);
  }

  @ApiOperation({
    summary: 'Create or update the payout bank account',
    description:
      'OWNER/CO_OWNER/ADMIN only — restricted beyond the tax profile since this controls where payouts are sent.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: BankAccountResponseDto })
  @Patch()
  upsert(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UpsertBankAccountDto,
  ) {
    return this.bankAccountService.upsert(restaurantId, dto, user);
  }

  @ApiOperation({ summary: 'Verify bank account (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: BankAccountResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('verify')
  verify(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.bankAccountService.verify(restaurantId, user);
  }

  @ApiOperation({ summary: 'Reject bank account (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: BankAccountResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('reject')
  reject(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.bankAccountService.reject(restaurantId, user);
  }
}
