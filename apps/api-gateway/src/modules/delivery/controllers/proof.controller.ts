import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { DeliveryProofType } from '@prisma/client';

import { ProofService } from '../services/proof.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { VerifyProofOtpDto } from '../dto/verify-proof-otp.dto';
import { ProofOtpGeneratedResponseDto } from '../dto/proof-otp-generated-response.dto';
import { ProofOtpStatusResponseDto } from '../dto/proof-otp-status-response.dto';

@ApiTags('Delivery Proof')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('delivery/orders/:orderId/proof')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Post('pickup/generate')
  @ApiOperation({
    summary: 'Generate (or regenerate) the pickup OTP',
    description:
      'Sends a fresh 6-digit code to the customer. Calling this again before verification overwrites the previous code and resets the attempt count — this is also how a partner regenerates an expired or exhausted OTP. Only valid while the order is READY_FOR_PICKUP.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({ type: ProofOtpGeneratedResponseDto })
  @ApiForbiddenResponse({ description: 'Not the assigned delivery partner' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  generatePickupOtp(
    @Param('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.proofService.generatePickupOtp(orderId, user);
  }

  @Post('pickup/verify')
  @ApiOperation({
    summary: 'Verify the pickup OTP',
    description:
      'On success, advances the order to OUT_FOR_DELIVERY and emits pickup.verified.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiBody({ type: VerifyProofOtpDto })
  @ApiOkResponse({ type: ProofOtpStatusResponseDto })
  @ApiConflictResponse({ description: 'Already verified' })
  @ApiForbiddenResponse({
    description: 'Not the assigned delivery partner, or attempts exceeded',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  verifyPickupOtp(
    @Param('orderId') orderId: string,
    @Body() dto: VerifyProofOtpDto,
    @CurrentUser() user: any,
  ) {
    return this.proofService.verifyPickupOtp(orderId, dto.code, user);
  }

  @Get('pickup/status')
  @ApiOperation({ summary: 'Get the current pickup OTP status' })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({ type: ProofOtpStatusResponseDto })
  @ApiNotFoundResponse({ description: 'No pickup OTP generated yet' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getPickupStatus(@Param('orderId') orderId: string, @CurrentUser() user: any) {
    return this.proofService.getProofStatus(
      orderId,
      DeliveryProofType.PICKUP,
      user,
    );
  }

  @Post('delivery/generate')
  @ApiOperation({
    summary: 'Generate (or regenerate) the delivery OTP',
    description:
      'Sends a fresh 6-digit code to the customer. Calling this again before verification overwrites the previous code and resets the attempt count. Only valid while the order is OUT_FOR_DELIVERY.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({ type: ProofOtpGeneratedResponseDto })
  @ApiForbiddenResponse({ description: 'Not the assigned delivery partner' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  generateDeliveryOtp(
    @Param('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.proofService.generateDeliveryOtp(orderId, user);
  }

  @Post('delivery/verify')
  @ApiOperation({
    summary: 'Verify the delivery OTP',
    description:
      'On success, advances the order to DELIVERED and emits delivery.verified.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiBody({ type: VerifyProofOtpDto })
  @ApiOkResponse({ type: ProofOtpStatusResponseDto })
  @ApiConflictResponse({ description: 'Already verified' })
  @ApiForbiddenResponse({
    description: 'Not the assigned delivery partner, or attempts exceeded',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  verifyDeliveryOtp(
    @Param('orderId') orderId: string,
    @Body() dto: VerifyProofOtpDto,
    @CurrentUser() user: any,
  ) {
    return this.proofService.verifyDeliveryOtp(orderId, dto.code, user);
  }

  @Get('delivery/status')
  @ApiOperation({ summary: 'Get the current delivery OTP status' })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({ type: ProofOtpStatusResponseDto })
  @ApiNotFoundResponse({ description: 'No delivery OTP generated yet' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getDeliveryStatus(
    @Param('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.proofService.getProofStatus(
      orderId,
      DeliveryProofType.DELIVERY,
      user,
    );
  }
}
