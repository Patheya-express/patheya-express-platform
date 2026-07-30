import { Controller, Get, Query } from '@nestjs/common';

import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CustomerHomeService } from '../services/customer-home.service';
import { GetCustomerHomeQueryDto } from '../dto/get-customer-home-query.dto';
import { CustomerHomeResponseDto } from '../dto/customer-home-response.dto';

@ApiTags('Customer')
@Controller('customer/home')
export class CustomerHomeController {
  constructor(private readonly customerHomeService: CustomerHomeService) {}

  @ApiOperation({
    summary: 'Get customer home screen',
    description:
      "Public — composes banners, featured/nearby/popular/recommended restaurants, and cuisines into a single response for the customer app's home screen. Nearby/recommended sections are empty until lat/lng are supplied.",
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'lng',
    required: false,
    type: Number,
  })
  @ApiOkResponse({
    description: 'Home screen data retrieved successfully',
    type: CustomerHomeResponseDto,
  })
  @Get()
  getHome(
    @Query()
    query: GetCustomerHomeQueryDto,
  ) {
    return this.customerHomeService.getHome(query);
  }
}
