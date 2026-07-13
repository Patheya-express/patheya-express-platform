import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SettingsService } from '../services/settings.service';

import { UpsertRestaurantSettingsDto } from '../dto/upsert-restaurant-settings.dto';
import { RestaurantSettingsResponseDto } from '../dto/restaurant-settings-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Settings')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @ApiOperation({ summary: 'Get restaurant settings' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: RestaurantSettingsResponseDto })
  @Get()
  find(@CurrentUser() user: any, @Param('restaurantId') restaurantId: string) {
    return this.settingsService.find(restaurantId, user);
  }

  @ApiOperation({
    summary: 'Create or update restaurant settings',
    description: 'OWNER/CO_OWNER/FINANCE_MANAGER/ADMIN only.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: RestaurantSettingsResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @Patch()
  upsert(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UpsertRestaurantSettingsDto,
  ) {
    return this.settingsService.upsert(restaurantId, dto, user);
  }
}
