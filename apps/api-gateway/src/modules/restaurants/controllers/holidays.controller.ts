import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HolidaysService } from '../services/holidays.service';

import { CreateHolidayDto } from '../dto/create-holiday.dto';
import { UpdateHolidayDto } from '../dto/update-holiday.dto';
import { HolidayResponseDto } from '../dto/holiday-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Holidays')
@Controller('restaurants/:restaurantId/holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @ApiOperation({
    summary: 'List holiday-calendar entries',
    description: 'Public — no authentication required.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOkResponse({ type: HolidayResponseDto, isArray: true })
  @Get()
  findAll(
    @Param('restaurantId') restaurantId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.holidaysService.findAll(restaurantId, branchId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Add a holiday-calendar entry',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: HolidayResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateHolidayDto,
  ) {
    return this.holidaysService.create(restaurantId, dto, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update a holiday-calendar entry',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'holidayId' })
  @ApiOkResponse({ type: HolidayResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @ApiResponse({ status: 404, description: 'Holiday not found' })
  @UseGuards(JwtAuthGuard)
  @Patch(':holidayId')
  update(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('holidayId') holidayId: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidaysService.update(restaurantId, holidayId, dto, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Remove a holiday-calendar entry',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'holidayId' })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @ApiResponse({ status: 404, description: 'Holiday not found' })
  @UseGuards(JwtAuthGuard)
  @Delete(':holidayId')
  remove(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('holidayId') holidayId: string,
  ) {
    return this.holidaysService.remove(restaurantId, holidayId, user);
  }
}
