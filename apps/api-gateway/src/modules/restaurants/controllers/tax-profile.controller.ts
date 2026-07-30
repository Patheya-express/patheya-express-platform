import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { TaxProfileService } from '../services/tax-profile.service';

import { UpsertTaxProfileDto } from '../dto/upsert-tax-profile.dto';
import { TaxProfileResponseDto } from '../dto/tax-profile-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Tax Profile')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/tax-profile')
@UseGuards(JwtAuthGuard)
export class TaxProfileController {
  constructor(private readonly taxProfileService: TaxProfileService) {}

  @ApiOperation({
    summary: 'Get tax profile (GST/FSSAI/PAN/CIN/business type)',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: TaxProfileResponseDto })
  @Get()
  find(@CurrentUser() user: any, @Param('restaurantId') restaurantId: string) {
    return this.taxProfileService.find(restaurantId, user);
  }

  @ApiOperation({ summary: 'Create or update the tax profile' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: TaxProfileResponseDto })
  @Patch()
  upsert(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UpsertTaxProfileDto,
  ) {
    return this.taxProfileService.upsert(restaurantId, dto, user);
  }

  @ApiOperation({ summary: 'Verify GST (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: TaxProfileResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('gst/verify')
  verifyGst(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.taxProfileService.verifyGst(restaurantId, user);
  }

  @ApiOperation({ summary: 'Reject GST (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: TaxProfileResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('gst/reject')
  rejectGst(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.taxProfileService.rejectGst(restaurantId, user);
  }

  @ApiOperation({ summary: 'Verify FSSAI (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: TaxProfileResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('fssai/verify')
  verifyFssai(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.taxProfileService.verifyFssai(restaurantId, user);
  }

  @ApiOperation({ summary: 'Reject FSSAI (admin only)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: TaxProfileResponseDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('fssai/reject')
  rejectFssai(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.taxProfileService.rejectFssai(restaurantId, user);
  }
}
