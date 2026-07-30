import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { OperatingHoursService } from '../services/operating-hours.service';

import { ReplaceOperatingHoursDto } from '../dto/replace-operating-hours.dto';
import { OperatingHourResponseDto } from '../dto/operating-hour-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Branch Operating Hours')
@Controller('restaurants/:restaurantId/branches/:branchId/operating-hours')
export class OperatingHoursController {
  constructor(private readonly operatingHoursService: OperatingHoursService) {}

  @ApiOperation({
    summary: 'Get weekly operating hours for a branch',
    description: 'Public — no authentication required.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'branchId' })
  @ApiOkResponse({ type: OperatingHourResponseDto, isArray: true })
  @Get()
  findAll(
    @Param('restaurantId') restaurantId: string,
    @Param('branchId') branchId: string,
  ) {
    return this.operatingHoursService.findAll(restaurantId, branchId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Replace the full weekly operating-hours schedule for a branch',
    description:
      'OWNER/CO_OWNER/ADMIN, or the BRANCH_MANAGER assigned to this specific branch. Supports ' +
      'split shifts (multiple entries with the same dayOfWeek) and closed days (isClosed).',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'branchId' })
  @ApiOkResponse({ type: OperatingHourResponseDto, isArray: true })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this branch',
  })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  @UseGuards(JwtAuthGuard)
  @Put()
  replaceAll(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('branchId') branchId: string,
    @Body() dto: ReplaceOperatingHoursDto,
  ) {
    return this.operatingHoursService.replaceAll(
      restaurantId,
      branchId,
      dto,
      user,
    );
  }
}
