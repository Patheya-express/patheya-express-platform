import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ProfileService } from '../services/profile.service';

import { UpdateDeliveryProfileDto } from '../dto/update-delivery-profile.dto';
import { DeliveryProfileResponseDto } from '../dto/delivery-profile-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Delivery Profile')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @ApiOperation({
    summary: 'Get my personal details/addresses/emergency contact/languages',
  })
  @ApiOkResponse({ type: DeliveryProfileResponseDto })
  @Get()
  getMyProfile(@CurrentUser() user: any) {
    return this.profileService.getMyProfile(user.userId);
  }

  @ApiOperation({
    summary: 'Update my personal details/addresses/emergency contact/languages',
  })
  @ApiOkResponse({ type: DeliveryProfileResponseDto })
  @Patch()
  updateMyProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateDeliveryProfileDto,
  ) {
    return this.profileService.updateMyProfile(user.userId, dto);
  }
}
