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
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import { OfferType } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { OffersService } from '../services/offers.service';

import { GetOffersQueryDto } from '../dto/get-offers-query.dto';
import { GetRestaurantOffersQueryDto } from '../dto/get-restaurant-offers-query.dto';
import { PaginatedOffersResponseDto } from '../dto/paginated-offers-response.dto';
import { OfferResponseDto } from '../dto/offer-response.dto';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';

@ApiTags('Offers')
@ApiBearerAuth('JWT-auth')
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ApiOperation({
    summary: 'List active offers',
    description:
      'Paginated, searchable, filterable list of currently active offers (isActive and within their start/end window).',
  })
  @ApiOkResponse({
    description: 'Offers retrieved successfully',
    type: PaginatedOffersResponseDto,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'restaurantId', required: false })
  @ApiQuery({ name: 'type', required: false, enum: OfferType })
  findAll(
    @Query()
    query: GetOffersQueryDto,
  ) {
    return this.offersService.findAll(query);
  }

  @Get('featured')
  @ApiOperation({
    summary: 'Get featured offers',
    description: 'A short, non-paginated list of active offers, newest first.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Featured offers retrieved successfully',
    type: OfferResponseDto,
    isArray: true,
  })
  findFeatured(
    @Query('limit')
    limit?: number,
  ) {
    return this.offersService.findFeatured(limit ? Number(limit) : undefined);
  }

  @Get('home')
  @ApiOperation({
    summary: 'Get the offers shown on the customer home banners',
    description:
      'Same active-offer criteria as /offers/featured — exposed separately so the home page banner carousel can be fetched on its own.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Home offers retrieved successfully',
    type: OfferResponseDto,
    isArray: true,
  })
  findHome(
    @Query('limit')
    limit?: number,
  ) {
    return this.offersService.findHome(limit ? Number(limit) : undefined);
  }

  @Get('restaurants/:restaurantId')
  @ApiOperation({
    summary: "Get a restaurant's active offers",
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Restaurant offers retrieved successfully',
    type: PaginatedOffersResponseDto,
  })
  findByRestaurant(
    @Param('restaurantId')
    restaurantId: string,

    @Query()
    query: GetOffersQueryDto,
  ) {
    return this.offersService.findByRestaurant(restaurantId, query);
  }

  @Get('manage/:restaurantId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Get a restaurant's offers for management",
    description:
      'Every offer for the restaurant regardless of active window (enabled, disabled, expired, or not yet started) — unlike GET /offers/restaurants/:restaurantId, which only returns currently-live offers. Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiOkResponse({
    description: 'Offers retrieved successfully',
    type: PaginatedOffersResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  findAllForRestaurant(
    @CurrentUser()
    user: any,

    @Param('restaurantId')
    restaurantId: string,

    @Query()
    query: GetRestaurantOffersQueryDto,
  ) {
    return this.offersService.findAllForRestaurant(restaurantId, query, user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get offer details',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Offer retrieved successfully',
    type: OfferResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Offer not found or no longer active',
  })
  findById(
    @Param('id')
    id: string,
  ) {
    return this.offersService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create a restaurant offer',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiCreatedResponse({
    description: 'Offer created successfully',
    type: OfferResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  create(
    @CurrentUser()
    user: any,

    @Body()
    dto: CreateOfferDto,
  ) {
    return this.offersService.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Update a restaurant offer',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Offer updated successfully',
    type: OfferResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Offer not found',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  update(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Body()
    dto: UpdateOfferDto,
  ) {
    return this.offersService.update(id, dto, user);
  }

  @Patch(':id/enable')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Enable a restaurant offer',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Offer enabled successfully',
    type: OfferResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Offer not found',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  enable(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.offersService.setActive(id, true, user);
  }

  @Patch(':id/disable')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Disable a restaurant offer',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Offer disabled successfully',
    type: OfferResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Offer not found',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  disable(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.offersService.setActive(id, false, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Delete a restaurant offer',
    description:
      'Restaurant OWNER/CO_OWNER/BRANCH_MANAGER or platform ADMIN only.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({
    description: 'Offer deleted successfully',
  })
  @ApiNotFoundResponse({
    description: 'Offer not found',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not manage this restaurant',
  })
  remove(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.offersService.delete(id, user);
  }
}
