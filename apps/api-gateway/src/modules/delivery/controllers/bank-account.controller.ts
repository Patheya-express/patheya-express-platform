import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { BankAccountService } from '../services/bank-account.service';

import { UpsertDeliveryBankAccountDto } from '../dto/upsert-delivery-bank-account.dto';
import { DeliveryBankAccountResponseDto } from '../dto/delivery-bank-account-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Delivery Bank Account')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/bank-account')
@UseGuards(JwtAuthGuard)
export class DeliveryBankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @ApiOperation({ summary: 'Get my settlement bank account' })
  @ApiOkResponse({ type: DeliveryBankAccountResponseDto })
  @Get()
  find(@CurrentUser() user: any) {
    return this.bankAccountService.findForSelf(user.userId);
  }

  @ApiOperation({
    summary: 'Create or replace my settlement bank account',
    description: 'Any change resets verificationStatus back to PENDING.',
  })
  @ApiOkResponse({ type: DeliveryBankAccountResponseDto })
  @Put()
  upsert(@CurrentUser() user: any, @Body() dto: UpsertDeliveryBankAccountDto) {
    return this.bankAccountService.upsert(user.userId, dto);
  }
}

@ApiTags('Delivery Bank Account (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/admin/:deliveryPartnerId/bank-account')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminBankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @ApiOperation({ summary: 'Verify a partner bank account' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryBankAccountResponseDto })
  @Patch('verify')
  verify(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
  ) {
    return this.bankAccountService.verify(deliveryPartnerId, user.userId);
  }

  @ApiOperation({ summary: 'Reject a partner bank account' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryBankAccountResponseDto })
  @Patch('reject')
  reject(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
  ) {
    return this.bankAccountService.reject(deliveryPartnerId, user.userId);
  }
}
