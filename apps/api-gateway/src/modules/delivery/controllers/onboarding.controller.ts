import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBody,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { OnboardingService } from '../services/onboarding.service';

import { SubmitDeliveryOnboardingDto } from '../dto/submit-delivery-onboarding.dto';
import { RequestDeliveryOnboardingChangesDto } from '../dto/request-delivery-onboarding-changes.dto';
import { DeliveryOnboardingResponseDto } from '../dto/delivery-onboarding-response.dto';
import { RecordBackgroundCheckConsentDto } from '../dto/record-background-check-consent.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

@ApiTags('Delivery Onboarding')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/onboarding')
@UseGuards(JwtAuthGuard)
export class DeliveryOnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @ApiOperation({ summary: 'Get my onboarding progress' })
  @ApiOkResponse({ type: DeliveryOnboardingResponseDto })
  @Get()
  getState(@CurrentUser() user: any) {
    return this.onboardingService.getState(user.userId);
  }

  @ApiOperation({
    summary: 'Mark a wizard step complete',
    description:
      "Records wizard progress. The step's data must already be saved via the dedicated " +
      'endpoint for that section (profile, vehicles, documents, bank account, background-check ' +
      'consent) — the backend verifies it exists and returns 400 otherwise.',
  })
  @ApiParam({ name: 'step', description: '1-12' })
  @ApiOkResponse({ type: DeliveryOnboardingResponseDto })
  @Patch('steps/:step')
  completeStep(
    @CurrentUser() user: any,
    @Param('step', ParseIntPipe) step: number,
  ) {
    return this.onboardingService.completeStep(user.userId, step);
  }

  @ApiOperation({
    summary: 'Record background-check consent (wizard step 11)',
    description:
      'Stores when the partner consented to the background verification check. Idempotent — ' +
      'the first consent timestamp is kept.',
  })
  @ApiBody({ type: RecordBackgroundCheckConsentDto })
  @ApiOkResponse({ type: DeliveryOnboardingResponseDto })
  @Post('background-check-consent')
  recordBackgroundCheckConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordBackgroundCheckConsentDto,
  ) {
    return this.onboardingService.recordBackgroundCheckConsent(
      user.userId,
      dto.consent,
    );
  }

  @ApiOperation({
    summary: 'Submit the onboarding application for review',
    description:
      'Requires steps 1-11 complete and acceptedTerms=true. Delegates to the existing verification submit flow.',
  })
  @ApiOkResponse({ type: DeliveryOnboardingResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Steps incomplete or terms not accepted',
  })
  @Post('submit')
  submit(@CurrentUser() user: any, @Body() dto: SubmitDeliveryOnboardingDto) {
    return this.onboardingService.submit(user.userId, dto);
  }
}

@ApiTags('Delivery Onboarding (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/admin/:deliveryPartnerId/onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminOnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @ApiOperation({ summary: 'Request corrections from the delivery partner' })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryOnboardingResponseDto })
  @Patch('request-changes')
  requestChanges(
    @CurrentUser() user: any,
    @Param('deliveryPartnerId') deliveryPartnerId: string,
    @Body() dto: RequestDeliveryOnboardingChangesDto,
  ) {
    return this.onboardingService.requestChanges(
      deliveryPartnerId,
      dto,
      user.userId,
    );
  }
}
