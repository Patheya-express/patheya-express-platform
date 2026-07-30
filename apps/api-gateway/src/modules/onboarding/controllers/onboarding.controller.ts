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
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { OnboardingService } from '../services/onboarding.service';

import { SubmitOnboardingDto } from '../dto/submit-onboarding.dto';
import { RequestOnboardingChangesDto } from '../dto/request-onboarding-changes.dto';
import { OnboardingResponseDto } from '../dto/onboarding-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Onboarding')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @ApiOperation({ summary: 'Get onboarding progress' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: OnboardingResponseDto })
  @Get()
  getState(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.onboardingService.getState(restaurantId, user);
  }

  @ApiOperation({
    summary: 'Mark a wizard step complete',
    description:
      "Records wizard progress only — the step's actual data is saved via the existing " +
      'dedicated endpoint for that section (restaurant profile, branches, tax profile, etc.) ' +
      'before this is called.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'step', description: '1-12' })
  @ApiOkResponse({ type: OnboardingResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch('steps/:step')
  completeStep(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('step', ParseIntPipe) step: number,
  ) {
    return this.onboardingService.completeStep(restaurantId, step, user);
  }

  @ApiOperation({
    summary: 'Submit the onboarding application for review',
    description:
      'Requires steps 1-11 complete and acceptedTerms=true. Delegates to the existing verification submit flow.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: OnboardingResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Steps incomplete or terms not accepted',
  })
  @Post('submit')
  submit(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: SubmitOnboardingDto,
  ) {
    return this.onboardingService.submit(restaurantId, dto, user);
  }

  @ApiOperation({
    summary: 'Request corrections from the restaurant owner (admin only)',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: OnboardingResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('request-changes')
  requestChanges(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: RequestOnboardingChangesDto,
  ) {
    return this.onboardingService.requestChanges(
      restaurantId,
      dto,
      user.userId,
    );
  }
}
