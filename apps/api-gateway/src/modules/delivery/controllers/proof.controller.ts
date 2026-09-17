import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
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

import type { UploadFile } from '../../../shared/types/upload-file.type';
import {
  createUploadInterceptorOptions,
  IMAGE_MAX_SIZE_BYTES,
  IMAGE_MIME_TYPES,
} from '../../storage/utils/upload-validation.util';

import { VerifyProofOtpDto } from '../dto/verify-proof-otp.dto';
import { ProofOtpGeneratedResponseDto } from '../dto/proof-otp-generated-response.dto';
import { ProofOtpStatusResponseDto } from '../dto/proof-otp-status-response.dto';
import { ProofPhotoResponseDto } from '../dto/proof-photo-response.dto';
import { MarkRestaurantArrivalDto } from '../dto/mark-restaurant-arrival.dto';
import { RestaurantArrivalResponseDto } from '../dto/restaurant-arrival-response.dto';

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

  @Post('pickup/photo')
  @ApiOperation({
    summary: 'Upload the mandatory pickup-parcel photo',
    description:
      'Write-once — a second upload for the same order is rejected. Only valid while the order is READY_FOR_PICKUP. This photo is required before OUT_FOR_DELIVERY can be reached.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: ProofPhotoResponseDto })
  @ApiConflictResponse({ description: 'A pickup photo already exists' })
  @ApiForbiddenResponse({ description: 'Not the assigned delivery partner' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadInterceptorOptions(IMAGE_MIME_TYPES, IMAGE_MAX_SIZE_BYTES),
    ),
  )
  uploadPickupPhoto(
    @Param('orderId') orderId: string,
    @UploadedFile() file: UploadFile,
    @CurrentUser() user: any,
  ) {
    return this.proofService.uploadPickupPhoto(orderId, file, user);
  }

  @Get('pickup/photo')
  @ApiOperation({
    summary: 'Get the pickup-parcel photo',
    description:
      'Readable by the order customer, its assigned delivery partner, its restaurant staff, or an admin.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({ type: ProofPhotoResponseDto })
  @ApiNotFoundResponse({ description: 'No pickup photo uploaded yet' })
  @ApiForbiddenResponse({ description: 'You do not have access to this order' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getPickupPhoto(@Param('orderId') orderId: string, @CurrentUser() user: any) {
    return this.proofService.getPickupPhoto(orderId, user);
  }

  @Post('pickup/arrival')
  @ApiOperation({
    summary: "Mark 'I've Arrived' at the restaurant",
    description:
      "Rider-only. Backend-authoritative: rejects unless the reported coordinates are within the configured radius of the order's actual pickup location. Idempotent — repeat calls after a successful arrival return the same recorded timestamp rather than erroring. Only valid while the order is READY_FOR_PICKUP.",
  })
  @ApiParam({ name: 'orderId' })
  @ApiBody({ type: MarkRestaurantArrivalDto })
  @ApiOkResponse({ type: RestaurantArrivalResponseDto })
  @ApiForbiddenResponse({ description: 'Not the assigned delivery partner' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  markRestaurantArrival(
    @Param('orderId') orderId: string,
    @Body() dto: MarkRestaurantArrivalDto,
    @CurrentUser() user: any,
  ) {
    return this.proofService.markRestaurantArrival(
      orderId,
      dto.latitude,
      dto.longitude,
      user,
    );
  }

  @Get('pickup/arrival')
  @ApiOperation({
    summary: 'Get restaurant-arrival status',
    description:
      'Readable by the order customer, its assigned delivery partner, its restaurant staff, or an admin.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({ type: RestaurantArrivalResponseDto })
  @ApiForbiddenResponse({ description: 'You do not have access to this order' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getArrivalStatus(
    @Param('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.proofService.getArrivalStatus(orderId, user);
  }
}
