import { ApiProperty } from '@nestjs/swagger';

import { RestaurantSummaryDto } from '../../restaurants/dto/restaurant-summary.dto';
import { CuisineResponseDto } from '../../restaurants/dto/cuisine-response.dto';
import { OfferResponseDto } from '../../offers/dto/offer-response.dto';

export class CustomerHomeResponseDto {
  @ApiProperty({
    type: [OfferResponseDto],
  })
  banners: OfferResponseDto[];

  @ApiProperty({
    type: [RestaurantSummaryDto],
  })
  featuredRestaurants: RestaurantSummaryDto[];

  @ApiProperty({
    type: [RestaurantSummaryDto],
    description:
      'Empty when the request did not include lat/lng — the client has not shared a location yet.',
  })
  nearbyRestaurants: RestaurantSummaryDto[];

  @ApiProperty({
    type: [RestaurantSummaryDto],
  })
  popularRestaurants: RestaurantSummaryDto[];

  @ApiProperty({
    type: [RestaurantSummaryDto],
    description:
      'Nearby + highly rated (avgRating >= 4) + open now. Empty when lat/lng was not provided.',
  })
  recommendedRestaurants: RestaurantSummaryDto[];

  @ApiProperty({
    type: [CuisineResponseDto],
  })
  cuisines: CuisineResponseDto[];
}
