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

import { RejectVerificationDto } from '../dto/reject-verification.dto';
import { VerificationResponseDto } from '../dto/verification-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Verification')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/verification')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @ApiOperation({
    summary: 'Get verification status',
    description:
      'Dedicated aggregate, separate from the coarse Restaurant.status enum — see stage for the detailed onboarding step.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: VerificationResponseDto })
  @Get()
  getStatus(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.verificationService.getStatus(restaurantId, user);
  }

  @ApiOperation({ summary: 'Submit for verification (DRAFT -> SUBMITTED)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: VerificationResponseDto })
  @Post('submit')
  submit(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.verificationService.submit(restaurantId, user);
  }

  @ApiOperation({
    summary: 'Advance to the next verification stage (admin only)',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: VerificationResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('advance')
  advance(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.verificationService.advance(restaurantId, user.userId);
  }

  @ApiOperation({ summary: 'Reject verification (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: VerificationResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('reject')
  reject(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: RejectVerificationDto,
  ) {
    return this.verificationService.reject(
      restaurantId,
      dto.rejectedReason,
      user.userId,
    );
  }

  @ApiOperation({ summary: 'Suspend an approved verification (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: VerificationResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('suspend')
  suspend(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.verificationService.suspend(restaurantId, user.userId);
  }

  @ApiOperation({ summary: 'Reinstate a suspended verification (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: VerificationResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('reinstate')
  reinstate(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.verificationService.reinstate(restaurantId, user.userId);
  }
}
