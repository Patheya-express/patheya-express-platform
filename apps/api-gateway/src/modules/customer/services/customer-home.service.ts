import { Injectable } from '@nestjs/common';

import { RestaurantsService } from '../../restaurants/services/restaurants.service';
import { CuisinesService } from '../../restaurants/services/cuisines.service';
import { OffersService } from '../../offers/services/offers.service';

import { GetCustomerHomeQueryDto } from '../dto/get-customer-home-query.dto';
import { CustomerHomeResponseDto } from '../dto/customer-home-response.dto';

const BANNER_LIMIT = 5;
const SECTION_LIMIT = 10;

/**
 * A thin composition layer, same shape as AdminService — no business logic of its own, just
 * orchestrates one bounded call per home shelf so the customer's coldest, highest-traffic
 * screen is a single round trip instead of 5+ separate requests.
 */
@Injectable()
export class CustomerHomeService {
  constructor(
    private readonly restaurantsService: RestaurantsService,

    private readonly cuisinesService: CuisinesService,

    private readonly offersService: OffersService,
  ) {}

  async getHome(
    query: GetCustomerHomeQueryDto,
  ): Promise<CustomerHomeResponseDto> {
    const hasLocation = query.lat !== undefined && query.lng !== undefined;

    const [
      banners,
      featuredRestaurants,
      popularRestaurants,
      cuisines,
      nearbyRestaurants,
      recommendedRestaurants,
    ] = await Promise.all([
      this.offersService.findHome(BANNER_LIMIT),
      this.restaurantsService.findFeatured(SECTION_LIMIT),
      this.restaurantsService.findPopular(SECTION_LIMIT),
      this.cuisinesService.findAll(),
      hasLocation
        ? this.restaurantsService.findNearby(
            query.lat as number,
            query.lng as number,
            SECTION_LIMIT,
          )
        : Promise.resolve([]),
      hasLocation
        ? this.restaurantsService.findRecommended(
            query.lat as number,
            query.lng as number,
            SECTION_LIMIT,
          )
        : Promise.resolve([]),
    ]);

    return {
      banners,
      featuredRestaurants,
      nearbyRestaurants,
      popularRestaurants,
      recommendedRestaurants,
      cuisines,
    };
  }
}
