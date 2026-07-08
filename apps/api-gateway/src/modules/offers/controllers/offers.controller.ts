import { Controller, Get, Param, Query } from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { OfferType } from '@prisma/client';

import { OffersService } from '../services/offers.service';

import { GetOffersQueryDto } from '../dto/get-offers-query.dto';
import { PaginatedOffersResponseDto } from '../dto/paginated-offers-response.dto';
import { OfferResponseDto } from '../dto/offer-response.dto';

@ApiTags('Offers')
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
}
