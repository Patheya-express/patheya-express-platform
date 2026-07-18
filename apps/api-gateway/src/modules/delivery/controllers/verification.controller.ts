import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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

import { VerificationService } from '../services/verification.service';

import { RejectDeliveryVerificationDto } from '../dto/reject-delivery-verification.dto';
import {
  DeliveryVerificationResponseDto,
  VerificationHistoryEntryDto,
} from '../dto/delivery-verification-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Delivery Verification')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/verification')
@UseGuards(JwtAuthGuard)
export class DeliveryVerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({
    summary: 'Get my verification status',
    description:
      'Dedicated aggregate, separate from the coarse DeliveryPartner.isVerified boolean — see stage for the detailed step.',
  })
  @ApiOkResponse({ type: DeliveryVerificationResponseDto })
  @Get()
  getStatus(@CurrentUser() user: any) {
    return this.verificationService.getStatus(user.userId);
  }

  @ApiOperation({ summary: 'My verification timeline' })
  @ApiOkResponse({ type: VerificationHistoryEntryDto, isArray: true })
  @Get('history')
  getHistory(@CurrentUser() user: any) {
    return this.verificationService.getHistory(user.userId);
  }

  @ApiOperation({ summary: 'Submit for verification (DRAFT -> SUBMITTED)' })
  @ApiOkResponse({ type: DeliveryVerificationResponseDto })
  @Post('submit')
  submit(@CurrentUser() user: any) {
    return this.verificationService.submit(user.userId);
  }
}

@ApiTags('Delivery Verification (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/admin/:deliveryPartnerId/verification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminVerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({ summary: 'Advance to the next verification stage' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryVerificationResponseDto })
  @Patch('advance')
  advance(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
  ) {
    return this.verificationService.advance(deliveryPartnerId, user.userId);
  }

  @ApiOperation({ summary: 'Reject verification' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryVerificationResponseDto })
  @Patch('reject')
  reject(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
    @Body() dto: RejectDeliveryVerificationDto,
  ) {
    return this.verificationService.reject(
      deliveryPartnerId,
      dto.rejectedReason,
      user.userId,
    );
  }

  @ApiOperation({ summary: 'Suspend an approved verification' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryVerificationResponseDto })
  @Patch('suspend')
  suspend(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
  ) {
    return this.verificationService.suspend(deliveryPartnerId, user.userId);
  }

  @ApiOperation({ summary: 'Reinstate a suspended verification' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryVerificationResponseDto })
  @Patch('reinstate')
  reinstate(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
  ) {
    return this.verificationService.reinstate(deliveryPartnerId, user.userId);
  }
}
