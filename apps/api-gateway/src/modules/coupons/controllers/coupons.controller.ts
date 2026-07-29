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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { CouponsService } from '../services/coupons.service';

import { ValidateCouponDto } from '../dto/validate-coupon.dto';
import { GetAvailableCouponsQueryDto } from '../dto/get-available-coupons-query.dto';
import { CreateCouponDto } from '../dto/create-coupon.dto';
import { UpdateCouponDto } from '../dto/update-coupon.dto';
import { GetAdminCouponsQueryDto } from '../dto/get-admin-coupons-query.dto';
import { CouponResponseDto } from '../dto/coupon-response.dto';
import { CouponValidationResponseDto } from '../dto/coupon-validation-response.dto';
import { PaginatedCouponsResponseDto } from '../dto/paginated-coupons-response.dto';

@ApiTags('Coupons')
@ApiBearerAuth('JWT-auth')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Validate a coupon code',
    description:
      'Checks every eligibility rule (exists, active, date window, minimum order, restaurant restriction, usage limits) and returns a full pricing preview as if the coupon were applied.',
  })
  @ApiOkResponse({ type: CouponValidationResponseDto })
  @Post('validate')
  validate(@CurrentUser() user: any, @Body() dto: ValidateCouponDto) {
    return this.couponsService.validate(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List currently available coupons',
    description:
      'Platform-wide coupons, plus restaurant-specific ones when restaurantId is provided. Does not check per-user usage — call validate for a specific code before applying it.',
  })
  @ApiQuery({ name: 'restaurantId', required: false })
  @ApiOkResponse({ type: [CouponResponseDto] })
  @Get('available')
  getAvailable(@Query() query: GetAvailableCouponsQueryDto) {
    return this.couponsService.getAvailable(query.restaurantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a coupon (admin)' })
  @ApiCreatedResponse({ type: CouponResponseDto })
  @Post()
  create(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List coupons (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiOkResponse({ type: PaginatedCouponsResponseDto })
  @Get()
  findAll(@Query() query: GetAdminCouponsQueryDto) {
    return this.couponsService.findAllForAdmin(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get a coupon by id (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: CouponResponseDto })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.couponsService.findByIdOrThrow(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a coupon (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: CouponResponseDto })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Disable a coupon (admin)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: CouponResponseDto })
  @Patch(':id/disable')
  disable(@Param('id') id: string) {
    return this.couponsService.disable(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a coupon (admin)' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.couponsService.delete(id);
  }
}
